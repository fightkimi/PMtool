import { and, eq, inArray, lt } from 'drizzle-orm';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import { db } from '@/lib/db';
import { getStagesByRun } from '@/lib/queries/pipeline_stage_instances';
import {
  pipelineRuns,
  pipelineStageInstances,
  pipelines,
  risks,
  tasks,
  users,
  type InsertRisk,
  type SelectPipeline,
  type SelectPipelineRun,
  type SelectPipelineStageInstance,
  type SelectRisk,
  type SelectTask,
  type SelectUser
} from '@/lib/schema';

type QueueLike = Pick<AgentQueue, 'enqueue'>;

type TaskLike = SelectTask & { assignee?: SelectUser | null };
type StageLike = SelectPipelineStageInstance & { assignee?: SelectUser | null };

type LibuBingDeps = BaseAgentDeps & {
  queue?: QueueLike;
  now?: () => Date;
  getBlockedTasks?: (projectId: string) => Promise<TaskLike[]>;
  getBlockedStages?: (projectId: string) => Promise<StageLike[]>;
  getDelayedCriticalStages?: (projectId: string, now: Date) => Promise<StageLike[]>;
  getUpcomingTasks?: (projectId: string, cutoff: Date, now: Date) => Promise<TaskLike[]>;
  getVarianceTasks?: (projectId: string) => Promise<TaskLike[]>;
  getRunsByProjectId?: (projectId: string) => Promise<SelectPipelineRun[]>;
  getPipelineById?: (id: string) => Promise<SelectPipeline | null>;
  getRiskByDescription?: (projectId: string, description: string) => Promise<SelectRisk | null>;
  createRisk?: (data: InsertRisk) => Promise<void>;
  updateRiskSeen?: (id: string, seenAt: Date) => Promise<void>;
  getStageById?: (id: string) => Promise<SelectPipelineStageInstance | null>;
  getUserById?: (id: string) => Promise<SelectUser | null>;
};

function daysDiff(target: Date, base: Date): number {
  return Math.ceil((target.getTime() - base.getTime()) / 86400000);
}

export class LibuBingAgent extends BaseAgent {
  readonly agentType = 'libu_bing' as const;

  private readonly queue: QueueLike;

  private readonly currentTime: () => Date;

  private readonly getBlockedTasksFn: (projectId: string) => Promise<TaskLike[]>;

  private readonly getBlockedStagesFn: (projectId: string) => Promise<StageLike[]>;

  private readonly getDelayedCriticalStagesFn: (projectId: string, now: Date) => Promise<StageLike[]>;

  private readonly getUpcomingTasksFn: (projectId: string, cutoff: Date, now: Date) => Promise<TaskLike[]>;

  private readonly getVarianceTasksFn: (projectId: string) => Promise<TaskLike[]>;

  private readonly getRunsByProjectIdFn: (projectId: string) => Promise<SelectPipelineRun[]>;

  private readonly getPipelineByIdFn: (id: string) => Promise<SelectPipeline | null>;

  private readonly getRiskByDescriptionFn: (projectId: string, description: string) => Promise<SelectRisk | null>;

  private readonly createRiskFn: (data: InsertRisk) => Promise<void>;

  private readonly updateRiskSeenFn: (id: string, seenAt: Date) => Promise<void>;

  private readonly getStageByIdFn: (id: string) => Promise<SelectPipelineStageInstance | null>;

  private readonly getUserByIdFn: (id: string) => Promise<SelectUser | null>;

  constructor(deps: LibuBingDeps = {}) {
    super(deps);
    this.queue = deps.queue ?? agentQueue;
    this.currentTime = deps.now ?? (() => new Date());
    this.getBlockedTasksFn = deps.getBlockedTasks ?? defaultGetBlockedTasks;
    this.getBlockedStagesFn = deps.getBlockedStages ?? defaultGetBlockedStages;
    this.getDelayedCriticalStagesFn = deps.getDelayedCriticalStages ?? defaultGetDelayedCriticalStages;
    this.getUpcomingTasksFn = deps.getUpcomingTasks ?? defaultGetUpcomingTasks;
    this.getVarianceTasksFn = deps.getVarianceTasks ?? defaultGetVarianceTasks;
    this.getRunsByProjectIdFn = deps.getRunsByProjectId ?? defaultGetRunsByProjectId;
    this.getPipelineByIdFn = deps.getPipelineById ?? defaultGetPipelineById;
    this.getRiskByDescriptionFn = deps.getRiskByDescription ?? defaultGetRiskByDescription;
    this.createRiskFn = deps.createRisk ?? defaultCreateRisk;
    this.updateRiskSeenFn = deps.updateRiskSeen ?? defaultUpdateRiskSeen;
    this.getStageByIdFn = deps.getStageById ?? defaultGetStageById;
    this.getUserByIdFn = deps.getUserById ?? defaultGetUserById;
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as Record<string, unknown>;
    if (typeof payload.stage_instance_id === 'string') {
      return this.handleCriticalPathAlert(payload);
    }
    if (typeof payload.user_id === 'string') {
      return this.handleOverloadAlert(payload);
    }
    return this.handleDailyScan(payload as { project_id: string });
  }

  private async handleDailyScan(payload: { project_id: string }): Promise<AgentMessage> {
    const project = await this.getProject(payload.project_id);
    const now = this.currentTime();
    const cutoff = new Date(now.getTime() + 2 * 86400000);

    const blockedTasks = await this.getBlockedTasksFn(project.id);
    for (const task of blockedTasks) {
      const mention = task.assignee?.imUserId ?? task.assigneeId ?? '未分配';
      const description = `阻塞任务：${task.title}`;
      await this.notifyGroup(project.id, `🔴 [${project.name}] 阻塞任务：${task.title} · @${mention}`);
      await this.upsertRisk(project.id, description, 'high');
    }

    const delayedStages = await this.getDelayedCriticalStagesFn(project.id, now);
    for (const stage of delayedStages) {
      const overdueDays = stage.plannedEnd ? Math.max(1, daysDiff(now, stage.plannedEnd) * -1) : 1;
      const description = `关键路径延期：${stage.stageKey}`;
      await this.notifyGroup(
        project.id,
        `🔴 [${project.name}] 关键路径延期：${stage.stageKey} 阶段超出计划完成时间 ${overdueDays} 天`
      );
      await this.upsertRisk(project.id, description, 'critical');
    }

    const upcomingTasks = await this.getUpcomingTasksFn(project.id, cutoff, now);
    for (const task of upcomingTasks) {
      if (!task.dueAt) {
        continue;
      }
      const daysLeft = Math.max(1, daysDiff(task.dueAt, now));
      const mention = task.assignee?.imUserId ?? task.assigneeId ?? '未分配';
      await this.notifyGroup(
        project.id,
        `🟡 [${project.name}] 即将逾期：${task.title} 将在 ${daysLeft} 天后到期 · @${mention}`
      );
      await this.upsertRisk(project.id, `即将逾期：${task.title}`, 'medium');
    }

    const varianceTasks = await this.getVarianceTasksFn(project.id);
    for (const task of varianceTasks) {
      await this.notifyPM(
        project.id,
        `🟡 [${project.name}] 工时偏差：${task.title} 实际工时（${task.actualHours}h）已超预估（${task.estimatedHours}h）50%`
      );
    }

    await this.checkMilestoneRisk(project.id, project.name, now);

    return this.createMessage(
      'libu_bing',
      { project_id: project.id, scanned_at: now.toISOString() },
      {
        workspace_id: project.workspaceId,
        project_id: project.id,
        job_id: messageJobId(),
        trace_ids: []
      },
      2,
      'response'
    );
  }

  private async handleCriticalPathAlert(payload: Record<string, unknown>): Promise<AgentMessage> {
    const projectId = String(payload.project_id ?? '');
    const project = await this.getProject(projectId);
    const stage = await this.getStageByIdFn(String(payload.stage_instance_id));
    if (stage) {
      await this.notifyGroup(project.id, `🔴 [${project.name}] 关键路径预警：${stage.stageKey} 需要立即处理`);
    }

    return this.createMessage(
      'libu_bing',
      { alert: 'critical_path_sent', stage_instance_id: payload.stage_instance_id ?? null },
      {
        workspace_id: project.workspaceId,
        project_id: project.id,
        job_id: messageJobId(),
        trace_ids: []
      },
      1,
      'response'
    );
  }

  private async handleOverloadAlert(payload: Record<string, unknown>): Promise<AgentMessage> {
    const projectId = String(payload.project_id ?? '');
    const userId = String(payload.user_id ?? '');
    const roleType = String(payload.role_type ?? '');
    const weeks = Number(payload.weeks_overloaded ?? 0);
    const project = await this.getProject(projectId);
    const user = await this.getUserByIdFn(userId);

    await this.notifyPM(
      project.id,
      `🟡 [${project.name}] 产能超负荷：${roleType} 工种的 ${user?.name ?? userId} 已连续 ${weeks} 周满负荷`
    );

    return this.createMessage(
      'libu_bing',
      { alert: 'overload_notified', user_id: userId },
      {
        workspace_id: project.workspaceId,
        project_id: project.id,
        job_id: messageJobId(),
        trace_ids: []
      },
      2,
      'response'
    );
  }

  private async checkMilestoneRisk(projectId: string, projectName: string, now: Date): Promise<void> {
    const runs = await this.getRunsByProjectIdFn(projectId);

    for (const run of runs) {
      const pipeline = await this.getPipelineByIdFn(run.pipelineId);
      if (!pipeline) {
        continue;
      }

      const stages = await getStagesByRun(run.id);
      const criticalStages = stages.filter((stage) => Number(stage.floatDays ?? '0') === 0 && stage.plannedEnd);
      const latestCriticalEnd = criticalStages
        .map((stage) => stage.plannedEnd!)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      if (!latestCriticalEnd) {
        continue;
      }

      for (const anchor of pipeline.milestoneAnchors) {
        const anchorDate = new Date(run.createdAt);
        anchorDate.setDate(anchorDate.getDate() + anchor.offset_weeks * 7);
        const daysToAnchor = daysDiff(anchorDate, now);

        if (daysToAnchor <= 3 && latestCriticalEnd.getTime() > anchorDate.getTime()) {
          const delayDays = Math.ceil((latestCriticalEnd.getTime() - anchorDate.getTime()) / 86400000);
          await this.queue.enqueue(
            this.createMessage(
              'zhongshui',
              { reason: `里程碑风险：${anchor.name}`, project_id: projectId, run_id: run.id },
              {
                workspace_id: run.projectId ? (await this.getProject(projectId)).workspaceId : '',
                project_id: projectId,
                job_id: messageJobId(),
                trace_ids: []
              },
              1,
              'escalate'
            )
          );
          await this.notifyPM(projectId, `🔴 [${projectName}] 里程碑风险：${anchor.name} 可能在 ${delayDays} 天后延期`);
          await this.upsertRisk(projectId, `里程碑风险：${anchor.name}`, 'critical');
        }
      }
    }
  }

  private async upsertRisk(projectId: string, description: string, level: InsertRisk['level']): Promise<void> {
    const existing = await this.getRiskByDescriptionFn(projectId, description);
    if (existing) {
      await this.updateRiskSeenFn(existing.id, this.currentTime());
      return;
    }

    await this.createRiskFn({
      projectId,
      description,
      level,
      detectedBy: 'agent',
      status: 'open'
    });
  }
}

const libuBingAgent = new LibuBingAgent();

export default libuBingAgent;

/* v8 ignore next */
function messageJobId() {
  return `job-${Date.now()}`;
}

/* v8 ignore next */
async function defaultGetBlockedTasks(projectId: string): Promise<TaskLike[]> {
  const rows = await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'blocked')));
  return enrichTasks(rows);
}

/* v8 ignore next */
async function defaultGetBlockedStages(projectId: string): Promise<StageLike[]> {
  const runs = await defaultGetRunsByProjectId(projectId);
  if (runs.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(pipelineStageInstances)
    .where(and(inArray(pipelineStageInstances.runId, runs.map((run) => run.id)), eq(pipelineStageInstances.status, 'blocked')));
  return enrichStages(rows);
}

/* v8 ignore next */
async function defaultGetDelayedCriticalStages(projectId: string, now: Date): Promise<StageLike[]> {
  const runs = await defaultGetRunsByProjectId(projectId);
  if (runs.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(pipelineStageInstances)
    .where(and(inArray(pipelineStageInstances.runId, runs.map((run) => run.id)), eq(pipelineStageInstances.floatDays, '0')));
  return (await enrichStages(rows)).filter((stage) => stage.plannedEnd != null && stage.plannedEnd.getTime() < now.getTime());
}

/* v8 ignore next */
async function defaultGetUpcomingTasks(projectId: string, cutoff: Date, now: Date): Promise<TaskLike[]> {
  const rows = await db.select().from(tasks).where(eq(tasks.projectId, projectId));
  return (await enrichTasks(rows)).filter(
    (task) =>
      task.dueAt != null &&
      task.dueAt.getTime() < cutoff.getTime() &&
      task.dueAt.getTime() > now.getTime() &&
      task.status !== 'done' &&
      task.status !== 'cancelled'
  );
}

/* v8 ignore next */
async function defaultGetVarianceTasks(projectId: string): Promise<TaskLike[]> {
  const rows = await db.select().from(tasks).where(eq(tasks.projectId, projectId));
  return (await enrichTasks(rows)).filter((task) => {
    const estimated = Number(task.estimatedHours ?? '0');
    const actual = Number(task.actualHours ?? '0');
    return estimated > 0 && actual > estimated * 1.5;
  });
}

/* v8 ignore next */
async function defaultGetRunsByProjectId(projectId: string): Promise<SelectPipelineRun[]> {
  return db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
}

/* v8 ignore next */
async function defaultGetPipelineById(id: string): Promise<SelectPipeline | null> {
  const rows = await db.select().from(pipelines).where(eq(pipelines.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetRiskByDescription(projectId: string, description: string): Promise<SelectRisk | null> {
  const rows = await db.select().from(risks).where(and(eq(risks.projectId, projectId), eq(risks.description, description)));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultCreateRisk(data: InsertRisk): Promise<void> {
  await db.insert(risks).values(data);
}

/* v8 ignore next */
async function defaultUpdateRiskSeen(id: string, seenAt: Date): Promise<void> {
  await db.update(risks).set({ lastSeenAt: seenAt }).where(eq(risks.id, id));
}

/* v8 ignore next */
async function defaultGetStageById(id: string): Promise<SelectPipelineStageInstance | null> {
  const rows = await db.select().from(pipelineStageInstances).where(eq(pipelineStageInstances.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetUserById(id: string): Promise<SelectUser | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function enrichTasks(rows: SelectTask[]): Promise<TaskLike[]> {
  const assigneeIds = [...new Set(rows.map((row) => row.assigneeId).filter((value): value is string => Boolean(value)))];
  const assignees = assigneeIds.length === 0 ? [] : await db.select().from(users).where(inArray(users.id, assigneeIds));
  const userMap = new Map(assignees.map((user) => [user.id, user]));
  return rows.map((row) => ({ ...row, assignee: row.assigneeId ? userMap.get(row.assigneeId) ?? null : null }));
}

/* v8 ignore next */
async function enrichStages(rows: SelectPipelineStageInstance[]): Promise<StageLike[]> {
  const assigneeIds = [...new Set(rows.map((row) => row.assigneeId).filter((value): value is string => Boolean(value)))];
  const assignees = assigneeIds.length === 0 ? [] : await db.select().from(users).where(inArray(users.id, assigneeIds));
  const userMap = new Map(assignees.map((user) => [user.id, user]));
  return rows.map((row) => ({ ...row, assignee: row.assigneeId ? userMap.get(row.assigneeId) ?? null : null }));
}
