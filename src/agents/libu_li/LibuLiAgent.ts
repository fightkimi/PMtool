import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import { db } from '@/lib/db';
import {
  capacitySnapshots,
  pipelineStageInstances,
  tasks,
  users,
  type SelectCapacitySnapshot,
  type SelectPipelineStageInstance,
  type SelectTask,
  type SelectUser
} from '@/lib/schema';

type Candidate = { user: SelectUser; reason: string } | null;

type LibuLiDeps = BaseAgentDeps & {
  getUsersBySkill?: (workspaceId: string, skill: string) => Promise<SelectUser[]>;
  countUserLoad?: (userId: string) => Promise<number>;
  getCapacitySnapshots?: (workspaceId: string, weeks: number, roleType?: string) => Promise<SelectCapacitySnapshot[]>;
  now?: () => Date;
};

function nextMonday(base: Date): Date {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const offset = day === 0 ? 1 : 8 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

export class LibuLiAgent extends BaseAgent {
  readonly agentType = 'libu_li' as const;

  private readonly getUsersBySkillFn: (workspaceId: string, skill: string) => Promise<SelectUser[]>;

  private readonly countUserLoadFn: (userId: string) => Promise<number>;

  private readonly getCapacitySnapshotsFn: (workspaceId: string, weeks: number, roleType?: string) => Promise<SelectCapacitySnapshot[]>;

  private readonly currentTime: () => Date;

  constructor(deps: LibuLiDeps = {}) {
    super(deps);
    this.getUsersBySkillFn = deps.getUsersBySkill ?? defaultGetUsersBySkill;
    this.countUserLoadFn = deps.countUserLoad ?? defaultCountUserLoad;
    this.getCapacitySnapshotsFn = deps.getCapacitySnapshots ?? defaultGetCapacitySnapshots;
    this.currentTime = deps.now ?? (() => new Date());
  }

  async recommendAssignee(
    taskOrStage: { department?: string | null; role_type?: string | null },
    workspaceId: string
  ): Promise<{ user: SelectUser; reason: string } | null> {
    const skill = taskOrStage.department ?? taskOrStage.role_type;
    if (!skill) {
      return null;
    }

    const candidates = await this.getUsersBySkillFn(workspaceId, skill);
    const withLoad = await Promise.all(
      candidates.map(async (user) => ({
        user,
        loadScore: await this.countUserLoadFn(user.id)
      }))
    );
    const filtered = withLoad.filter((item) => item.loadScore < 5).sort((a, b) => a.loadScore - b.loadScore);
    if (filtered.length === 0) {
      return null;
    }

    const selected = filtered[0]!;
    return {
      user: selected.user,
      reason: `${skill} 工种当前负载最低（load_score=${selected.loadScore}）`
    };
  }

  async getCapacityForecast(workspaceId: string, weeks: number, roleType?: string) {
    const snapshots = await this.getCapacitySnapshotsFn(workspaceId, weeks, roleType);
    return snapshots.map((snapshot) => ({
      week_start: snapshot.weekStart,
      role_type: snapshot.roleType,
      available_hours: Number(snapshot.availableHours),
      allocated_hours: Number(snapshot.allocatedHours)
    }));
  }

  async evaluateNewProject(spec: {
    workspaceId: string;
    role_requirements: Array<{ role_type: string; hours_needed: number }>;
    deadline: Date;
  }): Promise<{
    feasible: boolean;
    earliest_start: Date;
    estimated_end: Date;
    gaps: Array<{ role_type: string; shortfall_hours: number }>;
  }> {
    const snapshots = await this.getCapacitySnapshotsFn(spec.workspaceId, 12);
    const gaps = spec.role_requirements
      .map((req) => {
        const available = snapshots
          .filter((snapshot) => snapshot.roleType === req.role_type)
          .reduce((sum, snapshot) => sum + Number(snapshot.availableHours), 0);
        return {
          role_type: req.role_type,
          shortfall_hours: Math.max(0, req.hours_needed - available)
        };
      })
      .filter((item) => item.shortfall_hours > 0);

    return {
      feasible: gaps.length === 0,
      earliest_start: nextMonday(this.currentTime()),
      estimated_end: spec.deadline,
      gaps
    };
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as Record<string, unknown>;
    if (Array.isArray(payload.role_requirements)) {
      const result = await this.evaluateNewProject({
        workspaceId: String(payload.workspace_id ?? message.context.workspace_id),
        role_requirements: payload.role_requirements as Array<{ role_type: string; hours_needed: number }>,
        deadline: new Date(String(payload.deadline))
      });
      if (message.context.project_id) {
        await this.sendPMCard(message.context.project_id, {
          title: '项目可行性评估',
          content: result.feasible
            ? `可承接，预计完成时间 ${result.estimated_end.toISOString().slice(0, 10)}`
            : `存在缺口：${result.gaps.map((gap) => `${gap.role_type}:${gap.shortfall_hours}h`).join('、')}`
        });
      }
      return this.createMessage('libu_li', result as unknown as Record<string, unknown>, message.context, 2, 'response');
    }

    const result = await this.getCapacityForecast(
      String(payload.workspace_id ?? message.context.workspace_id),
      Number(payload.weeks ?? 4),
      typeof payload.role_type === 'string' ? payload.role_type : undefined
    );
    if (message.context.project_id) {
      await this.sendPMCard(message.context.project_id, {
        title: '产能预测',
        content: result.map((item) => `${item.week_start} ${item.role_type}: ${item.available_hours}/${item.allocated_hours}`).join('\n')
      });
    }
    return this.createMessage('libu_li', { forecast: result }, message.context, 2, 'response');
  }
}

const libuLiAgent = new LibuLiAgent();

export default libuLiAgent;

/* v8 ignore next */
async function defaultGetUsersBySkill(workspaceId: string, skill: string): Promise<SelectUser[]> {
  const rows = await db.select().from(users).where(eq(users.workspaceId, workspaceId));
  return rows.filter((user) => user.skills.includes(skill));
}

/* v8 ignore next */
async function defaultCountUserLoad(userId: string): Promise<number> {
  const activeTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, userId), eq(tasks.status, 'in_progress')));
  const activeStages = await db
    .select({ id: pipelineStageInstances.id })
    .from(pipelineStageInstances)
    .where(and(eq(pipelineStageInstances.assigneeId, userId), eq(pipelineStageInstances.status, 'active')));
  return activeTasks.length + activeStages.length;
}

/* v8 ignore next */
async function defaultGetCapacitySnapshots(
  workspaceId: string,
  weeks: number,
  roleType?: string
): Promise<SelectCapacitySnapshot[]> {
  const start = nextMonday(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  const rows = await db
    .select()
    .from(capacitySnapshots)
    .where(and(eq(capacitySnapshots.workspaceId, workspaceId), gte(capacitySnapshots.weekStart, start.toISOString().slice(0, 10)), lte(capacitySnapshots.weekStart, end.toISOString().slice(0, 10))));
  return roleType ? rows.filter((row) => row.roleType === roleType) : rows;
}
