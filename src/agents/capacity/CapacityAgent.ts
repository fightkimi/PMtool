import { and, eq, inArray } from 'drizzle-orm';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import type { AgentMessage } from '@/agents/base/types';
import { LibuLiAgent } from '@/agents/libu_li/LibuLiAgent';
import { db } from '@/lib/db';
import {
  capacitySnapshots,
  pipelineRuns,
  pipelineStageInstances,
  projects,
  tasks,
  users,
  type InsertCapacitySnapshot,
  type SelectCapacitySnapshot,
  type SelectPipelineStageInstance,
  type SelectProject,
  type SelectTask,
  type SelectUser
} from '@/lib/schema';

type QueueLike = Pick<AgentQueue, 'enqueue'>;

type SnapshotInput = {
  workspaceId: string;
  snapshotDate: string;
  weekStart: string;
  roleType: string;
  userId: string | null;
  totalHours: string;
  allocatedHours: string;
  availableHours: string;
  projectBreakdown: Record<string, number>;
  overloadFlag: boolean;
};

type CapacityDeps = BaseAgentDeps & {
  queue?: QueueLike;
  libuLiAgent?: Pick<LibuLiAgent, 'evaluateNewProject'>;
  getActiveProjects?: (workspaceId: string) => Promise<SelectProject[]>;
  getTasksByProject?: (projectId: string) => Promise<SelectTask[]>;
  getStagesByProject?: (projectId: string) => Promise<SelectPipelineStageInstance[]>;
  getUsersByIds?: (ids: string[]) => Promise<SelectUser[]>;
  upsertSnapshot?: (data: SnapshotInput) => Promise<void>;
  getOverloadedSnapshots?: (workspaceId: string) => Promise<SelectCapacitySnapshot[]>;
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

function daysOverlap(start: Date, end: Date, weekStart: Date, weekEnd: Date): number {
  const overlapStart = Math.max(start.getTime(), weekStart.getTime());
  const overlapEnd = Math.min(end.getTime(), weekEnd.getTime());
  return Math.max(0, Math.ceil((overlapEnd - overlapStart) / 86400000));
}

export class CapacityAgent extends BaseAgent {
  readonly agentType = 'capacity' as const;

  private readonly queue: QueueLike;

  private readonly libuLiAgent: Pick<LibuLiAgent, 'evaluateNewProject'>;

  private readonly getActiveProjectsFn: (workspaceId: string) => Promise<SelectProject[]>;

  private readonly getTasksByProjectFn: (projectId: string) => Promise<SelectTask[]>;

  private readonly getStagesByProjectFn: (projectId: string) => Promise<SelectPipelineStageInstance[]>;

  private readonly getUsersByIdsFn: (ids: string[]) => Promise<SelectUser[]>;

  private readonly upsertSnapshotFn: (data: SnapshotInput) => Promise<void>;

  private readonly getOverloadedSnapshotsFn: (workspaceId: string) => Promise<SelectCapacitySnapshot[]>;

  private readonly currentTime: () => Date;

  constructor(deps: CapacityDeps = {}) {
    super(deps);
    this.queue = deps.queue ?? agentQueue;
    this.libuLiAgent = deps.libuLiAgent ?? new LibuLiAgent();
    this.getActiveProjectsFn = deps.getActiveProjects ?? defaultGetActiveProjects;
    this.getTasksByProjectFn = deps.getTasksByProject ?? defaultGetTasksByProject;
    this.getStagesByProjectFn = deps.getStagesByProject ?? defaultGetStagesByProject;
    this.getUsersByIdsFn = deps.getUsersByIds ?? defaultGetUsersByIds;
    this.upsertSnapshotFn = deps.upsertSnapshot ?? defaultUpsertSnapshot;
    this.getOverloadedSnapshotsFn = deps.getOverloadedSnapshots ?? defaultGetOverloadedSnapshots;
    this.currentTime = deps.now ?? (() => new Date());
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as Record<string, unknown>;
    if (Array.isArray(payload.role_requirements)) {
      return this.handleEvaluateProject(payload as { workspace_id: string; role_requirements: Array<{ role_type: string; hours_needed: number }>; deadline: string; project_id: string });
    }
    return this.handleDailySnapshot(payload as { workspace_id: string });
  }

  private async handleDailySnapshot(payload: { workspace_id: string }): Promise<AgentMessage> {
    const projects = await this.getActiveProjectsFn(payload.workspace_id);
    const snapshotDate = this.currentTime().toISOString().slice(0, 10);

    for (const project of projects) {
      const [taskRows, stageRows] = await Promise.all([
        this.getTasksByProjectFn(project.id),
        this.getStagesByProjectFn(project.id)
      ]);
      const memberIds = [
        ...new Set(
          [project.pmId, ...taskRows.map((task) => task.assigneeId), ...stageRows.map((stage) => stage.assigneeId)].filter(
            (value): value is string => Boolean(value)
          )
        )
      ];
      const users = await this.getUsersByIdsFn(memberIds);

      for (const user of users) {
        const roleType = user.skills[0] ?? user.role;
        for (let weekIndex = 0; weekIndex < 8; weekIndex += 1) {
          const weekStart = nextMonday(this.currentTime());
          weekStart.setDate(weekStart.getDate() + weekIndex * 7);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);

          let allocated = 0;
          for (const stage of stageRows) {
            if (stage.assigneeId !== user.id || !stage.plannedStart || !stage.plannedEnd) {
              continue;
            }
            const totalDays = Math.max(1, Math.ceil((stage.plannedEnd.getTime() - stage.plannedStart.getTime()) / 86400000));
            const overlap = daysOverlap(stage.plannedStart, stage.plannedEnd, weekStart, weekEnd);
            allocated += (overlap / totalDays) * Number(stage.estimatedHours ?? '0');
          }

          for (const task of taskRows) {
            if (task.assigneeId !== user.id || task.status !== 'in_progress' || !task.dueAt) {
              continue;
            }
            if (task.dueAt >= weekStart && task.dueAt < weekEnd) {
              allocated += Number(task.estimatedHours ?? '0');
            }
          }

          if (allocated <= 0) {
            continue;
          }

          const totalHours = Number(user.workHoursPerWeek ?? '40');
          const overloadFlag = allocated > totalHours * 1.1;
          await this.upsertSnapshotFn({
            workspaceId: payload.workspace_id,
            snapshotDate,
            weekStart: weekStart.toISOString().slice(0, 10),
            roleType,
            userId: user.id,
            totalHours: String(totalHours),
            allocatedHours: String(Math.round(allocated * 10) / 10),
            availableHours: String(Math.round((totalHours - allocated) * 10) / 10),
            projectBreakdown: { [project.id]: Math.round(allocated * 10) / 10 },
            overloadFlag
          });
        }
      }
    }

    const overloads = await this.getOverloadedSnapshotsFn(payload.workspace_id);
    const byUser = new Map<string, SelectCapacitySnapshot[]>();
    for (const snapshot of overloads.filter((item) => item.overloadFlag && item.userId)) {
      byUser.set(snapshot.userId!, [...(byUser.get(snapshot.userId!) ?? []), snapshot]);
    }
    for (const [userId, snapshots] of byUser.entries()) {
      const ordered = [...snapshots].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      for (let i = 1; i < ordered.length; i += 1) {
        const prev = new Date(ordered[i - 1]!.weekStart);
        const curr = new Date(ordered[i]!.weekStart);
        if ((curr.getTime() - prev.getTime()) / 86400000 === 7) {
          await this.queue.enqueue(
            this.createMessage(
              'libu_bing',
              {
                project_id: Object.keys(ordered[i]!.projectBreakdown)[0] ?? '',
                user_id: userId,
                role_type: ordered[i]!.roleType,
                weeks_overloaded: 2
              },
              {
                workspace_id: payload.workspace_id,
                job_id: `job-${Date.now()}`,
                trace_ids: []
              }
            )
          );
          break;
        }
      }
    }

    console.log('update capacity heatmap placeholder');

    return this.createMessage(
      'capacity',
      { workspace_id: payload.workspace_id, snapshot_date: snapshotDate },
      {
        workspace_id: payload.workspace_id,
        job_id: `job-${Date.now()}`,
        trace_ids: []
      },
      2,
      'response'
    );
  }

  private async handleEvaluateProject(payload: {
    workspace_id: string;
    role_requirements: Array<{ role_type: string; hours_needed: number }>;
    deadline: string;
    project_id: string;
  }): Promise<AgentMessage> {
    const result = await this.libuLiAgent.evaluateNewProject({
      workspaceId: payload.workspace_id,
      role_requirements: payload.role_requirements,
      deadline: new Date(payload.deadline)
    });
    await this.sendPMCard(payload.project_id, {
      title: '新项目承接评估',
      content: result.feasible
        ? `可承接，预计结束时间 ${result.estimated_end.toISOString().slice(0, 10)}`
        : `资源缺口：${result.gaps.map((gap) => `${gap.role_type}:${gap.shortfall_hours}h`).join('、')}`
    });
    return this.createMessage('capacity', result as unknown as Record<string, unknown>, {
      workspace_id: payload.workspace_id,
      project_id: payload.project_id,
      job_id: `job-${Date.now()}`,
      trace_ids: []
    });
  }
}

const capacityAgent = new CapacityAgent();

export default capacityAgent;

/* v8 ignore next */
async function defaultGetActiveProjects(workspaceId: string): Promise<SelectProject[]> {
  return db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.status, 'active')));
}

/* v8 ignore next */
async function defaultGetTasksByProject(projectId: string): Promise<SelectTask[]> {
  return db.select().from(tasks).where(eq(tasks.projectId, projectId));
}

/* v8 ignore next */
async function defaultGetStagesByProject(projectId: string): Promise<SelectPipelineStageInstance[]> {
  const runs = await db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  if (runs.length === 0) {
    return [];
  }

  return db.select().from(pipelineStageInstances).where(inArray(pipelineStageInstances.runId, runs.map((run) => run.id)));
}

/* v8 ignore next */
async function defaultGetUsersByIds(ids: string[]): Promise<SelectUser[]> {
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(users).where(inArray(users.id, ids));
}

/* v8 ignore next */
async function defaultUpsertSnapshot(data: SnapshotInput): Promise<void> {
  const existing = await db
    .select()
    .from(capacitySnapshots)
    .where(
      and(
        eq(capacitySnapshots.workspaceId, data.workspaceId),
        eq(capacitySnapshots.weekStart, data.weekStart),
        eq(capacitySnapshots.roleType, data.roleType)
      )
    );
  const row = existing.find((item) => item.userId === data.userId);

  const payload: InsertCapacitySnapshot = {
    workspaceId: data.workspaceId,
    snapshotDate: data.snapshotDate,
    weekStart: data.weekStart,
    roleType: data.roleType,
    userId: data.userId,
    totalHours: data.totalHours,
    allocatedHours: data.allocatedHours,
    availableHours: data.availableHours,
    projectBreakdown: data.projectBreakdown,
    overloadFlag: data.overloadFlag
  };

  if (row) {
    await db.update(capacitySnapshots).set(payload).where(eq(capacitySnapshots.id, row.id));
    return;
  }

  await db.insert(capacitySnapshots).values(payload);
}

/* v8 ignore next */
async function defaultGetOverloadedSnapshots(workspaceId: string): Promise<SelectCapacitySnapshot[]> {
  return db
    .select()
    .from(capacitySnapshots)
    .where(
      and(
        eq(capacitySnapshots.workspaceId, workspaceId),
        eq(capacitySnapshots.overloadFlag, true)
      )
    );
}
