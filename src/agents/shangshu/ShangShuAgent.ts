import { eq, inArray } from 'drizzle-orm';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import { db } from '@/lib/db';
import { batchUpdateStages } from '@/lib/queries/pipeline_stage_instances';
import {
  changeRequests,
  pipelineStageInstances,
  tasks,
  users,
  type InsertChangeRequest,
  type InsertPipelineStageInstance,
  type InsertTask,
  type SelectChangeRequest,
  type SelectPipelineStageInstance,
  type SelectTask,
  type SelectUser
} from '@/lib/schema';

type AssigneeCandidate = SelectUser & { loadScore?: number };

type ShangShuDeps = BaseAgentDeps & {
  getTasksByIds?: (ids: string[]) => Promise<SelectTask[]>;
  getStagesByIds?: (ids: string[]) => Promise<SelectPipelineStageInstance[]>;
  getChangeRequestById?: (id: string) => Promise<SelectChangeRequest | null>;
  getStagesByRunIds?: (runIds: string[]) => Promise<SelectPipelineStageInstance[]>;
  getTasksByAffectedIds?: (ids: string[]) => Promise<SelectTask[]>;
  getCandidatesForDepartment?: (workspaceId: string, departmentOrRole: string) => Promise<AssigneeCandidate[]>;
  recommendAssignee?: (
    item: SelectTask | SelectPipelineStageInstance
  ) => Promise<AssigneeCandidate | null>;
  getUserById?: (id: string) => Promise<SelectUser | null>;
  updateTask?: (id: string, data: Partial<InsertTask>) => Promise<void>;
  batchUpdateStages?: typeof batchUpdateStages;
  updateChangeRequest?: (id: string, data: Partial<InsertChangeRequest>) => Promise<void>;
  syncPipelineTable?: (projectId: string, stages: SelectPipelineStageInstance[]) => Promise<void>;
  syncTasksTable?: (projectId: string, tasks: SelectTask[]) => Promise<void>;
};

function formatDate(date: Date | null | undefined): string {
  if (!date) {
    return '--/--';
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

function shiftDate(date: Date | null | undefined, days: number): Date | null {
  if (!date) {
    return null;
  }

  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export class ShangShuAgent extends BaseAgent {
  readonly agentType = 'shangshu' as const;

  private readonly getTasksByIdsFn: (ids: string[]) => Promise<SelectTask[]>;

  private readonly getStagesByIdsFn: (ids: string[]) => Promise<SelectPipelineStageInstance[]>;

  private readonly getChangeRequestByIdFn: (id: string) => Promise<SelectChangeRequest | null>;

  private readonly getStagesByRunIdsFn: (runIds: string[]) => Promise<SelectPipelineStageInstance[]>;

  private readonly getTasksByAffectedIdsFn: (ids: string[]) => Promise<SelectTask[]>;

  private readonly getCandidatesForDepartmentFn: (
    workspaceId: string,
    departmentOrRole: string
  ) => Promise<AssigneeCandidate[]>;

  private readonly recommendAssigneeFn?: (
    item: SelectTask | SelectPipelineStageInstance
  ) => Promise<AssigneeCandidate | null>;

  private readonly updateTaskFn: (id: string, data: Partial<InsertTask>) => Promise<void>;

  private readonly getUserByIdFn: (id: string) => Promise<SelectUser | null>;

  private readonly batchUpdateStagesFn: typeof batchUpdateStages;

  private readonly updateChangeRequestFn: (id: string, data: Partial<InsertChangeRequest>) => Promise<void>;

  private readonly syncPipelineTableFn: (projectId: string, stages: SelectPipelineStageInstance[]) => Promise<void>;

  private readonly syncTasksTableFn: (projectId: string, tasks: SelectTask[]) => Promise<void>;

  constructor(deps: ShangShuDeps = {}) {
    super(deps);
    this.getTasksByIdsFn = deps.getTasksByIds ?? defaultGetTasksByIds;
    this.getStagesByIdsFn = deps.getStagesByIds ?? defaultGetStagesByIds;
    this.getChangeRequestByIdFn = deps.getChangeRequestById ?? defaultGetChangeRequestById;
    this.getStagesByRunIdsFn = deps.getStagesByRunIds ?? defaultGetStagesByRunIds;
    this.getTasksByAffectedIdsFn = deps.getTasksByAffectedIds ?? defaultGetTasksByIds;
    this.getCandidatesForDepartmentFn = deps.getCandidatesForDepartment ?? defaultGetCandidatesForDepartment;
    this.recommendAssigneeFn = deps.recommendAssignee;
    this.getUserByIdFn = deps.getUserById ?? defaultGetUserById;
    this.updateTaskFn = deps.updateTask ?? defaultUpdateTask;
    this.batchUpdateStagesFn = deps.batchUpdateStages ?? batchUpdateStages;
    this.updateChangeRequestFn = deps.updateChangeRequest ?? defaultUpdateChangeRequest;
    this.syncPipelineTableFn =
      deps.syncPipelineTable ?? (async (_projectId, stages) => console.log('sync pipeline table placeholder', stages.length));
    this.syncTasksTableFn =
      deps.syncTasksTable ?? (async (_projectId, taskRows) => console.log('sync tasks table placeholder', taskRows.length));
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as Record<string, unknown>;
    if (typeof payload.change_request_id === 'string') {
      return this.handleChangeConfirmed(payload.change_request_id, message);
    }

    return this.handleAssignment(message);
  }

  private async handleAssignment(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as { mode: 'task' | 'pipeline'; ids: string[]; project_id: string };
    const projectId = payload.project_id;
    const project = await this.getProject(projectId);
    const notifiedUsers = new Set<string>();

    if (payload.mode === 'task') {
      const taskRows = (await this.getTasksByIdsFn(payload.ids)).filter((task) => !task.assigneeId);

      for (const task of taskRows) {
        const assignee = await this.resolveAssignee(project.workspaceId, task.department ?? 'libu_gong', task);
        if (!assignee) {
          continue;
        }

        await this.updateTaskFn(task.id, { assigneeId: assignee.id });
        if (assignee.imUserId) {
          notifiedUsers.add(assignee.imUserId);
          await this.getIMAdapter().sendDM(assignee.imUserId, {
            type: 'text',
            text: `你有新任务：${task.title}
截止日期：${formatDate(task.dueAt)}
验收标准：
${task.acceptanceCriteria.map((item) => `· ${item}`).join('\n') || '· 暂无'}`
          });
        }
      }

      await this.notifyGroup(projectId, `✅ 任务分配完成，共 ${taskRows.length} 个任务，请各负责人查看`);
      return this.createMessage('shangshu', { mode: 'task', assigned_count: taskRows.length }, message.context, 2, 'response');
    }

    const stageRows = (await this.getStagesByIdsFn(payload.ids)).filter((stage) => !stage.assigneeId);

    for (const stage of stageRows) {
      const assignee = await this.resolveAssignee(project.workspaceId, stage.roleType, stage);
      if (!assignee) {
        continue;
      }

      await this.batchUpdateStagesFn([{ id: stage.id, data: { assigneeId: assignee.id } }]);
      if (assignee.imUserId) {
        notifiedUsers.add(assignee.imUserId);
        await this.getIMAdapter().sendDM(assignee.imUserId, {
          type: 'text',
          text: `你有新任务：${stage.stageKey}
截止日期：${formatDate(stage.plannedEnd)}
验收标准：
· 完成 ${stage.roleType} 阶段交付`
        });
      }
    }

    await this.notifyGroup(projectId, `✅ 任务分配完成，共 ${stageRows.length} 个任务/阶段，请各负责人查看`);
    return this.createMessage('shangshu', { mode: 'pipeline', assigned_count: stageRows.length }, message.context, 2, 'response');
  }

  private async handleChangeConfirmed(changeRequestId: string, message: AgentMessage): Promise<AgentMessage> {
    const changeRequest = await this.getChangeRequestByIdFn(changeRequestId);
    if (!changeRequest) {
      throw new Error(`ChangeRequest not found: ${changeRequestId}`);
    }
    if (changeRequest.status !== 'evaluating') {
      throw new Error(`ChangeRequest ${changeRequestId} is not in evaluating status`);
    }

    const impactedStages = await this.getStagesByRunIdsFn(changeRequest.affectedRunIds);
    const stageUpdates = impactedStages.map((stage) => ({
      id: stage.id,
      data: {
        plannedStart: shiftDate(stage.plannedStart, changeRequest.scheduleImpactDays) ?? undefined,
        plannedEnd: shiftDate(stage.plannedEnd, changeRequest.scheduleImpactDays) ?? undefined
      } satisfies Partial<InsertPipelineStageInstance>
    }));
    if (stageUpdates.length > 0) {
      await this.batchUpdateStagesFn(stageUpdates);
      await this.syncPipelineTableFn(changeRequest.projectId, impactedStages);
    }

    const impactedTasks = await this.getTasksByAffectedIdsFn(changeRequest.affectedTaskIds);
    for (const task of impactedTasks) {
      await this.updateTaskFn(task.id, {
        dueAt: shiftDate(task.dueAt, changeRequest.scheduleImpactDays) ?? undefined
      });
    }
    if (impactedTasks.length > 0) {
      await this.syncTasksTableFn(changeRequest.projectId, impactedTasks);
    }

    await this.updateChangeRequestFn(changeRequestId, {
      status: 'implemented',
      cascadeExecutedAt: new Date()
    });

    for (const stage of impactedStages) {
      if (stage.assigneeId) {
        const user = await this.getUserByIdFn(stage.assigneeId);
        const targetUser = user;
        if (targetUser?.imUserId) {
          await this.getIMAdapter().sendDM(targetUser.imUserId, {
            type: 'text',
            text: `${stage.stageKey} 截止时间调整：${formatDate(stage.plannedEnd)} → ${formatDate(
              shiftDate(stage.plannedEnd, changeRequest.scheduleImpactDays)
            )}（原因：需求变更 ${changeRequest.title}）`
          });
        }
      }
    }

    for (const task of impactedTasks) {
      if (task.assigneeId) {
        const user = await this.getUserByIdFn(task.assigneeId);
        const targetUser = user;
        if (targetUser?.imUserId) {
          await this.getIMAdapter().sendDM(targetUser.imUserId, {
            type: 'text',
            text: `${task.title} 截止时间调整：${formatDate(task.dueAt)} → ${formatDate(
              shiftDate(task.dueAt, changeRequest.scheduleImpactDays)
            )}（原因：需求变更 ${changeRequest.title}）`
          });
        }
      }
    }

    await this.notifyGroup(
      changeRequest.projectId,
      `⚡ 变更已执行：${changeRequest.title}，共 ${impactedStages.length + impactedTasks.length} 人收到了新排期通知`
    );

    return this.createMessage(
      'shangshu',
      { change_request_id: changeRequestId, status: 'implemented' },
      {
        ...message.context,
        project_id: changeRequest.projectId
      },
      2,
      'response'
    );
  }

  private async resolveAssignee(
    workspaceId: string,
    departmentOrRole: string,
    item: SelectTask | SelectPipelineStageInstance
  ): Promise<AssigneeCandidate | null> {
    const recommended = await this.recommendAssigneeFn?.(item);
    if (recommended) {
      return recommended;
    }

    const candidates = await this.getCandidatesForDepartmentFn(workspaceId, departmentOrRole);
    if (candidates.length === 0) {
      return null;
    }

    return [...candidates].sort((a, b) => (a.loadScore ?? 0) - (b.loadScore ?? 0))[0] ?? null;
  }
}

const shangShuAgent = new ShangShuAgent();

export default shangShuAgent;

/* v8 ignore next */
async function defaultGetTasksByIds(ids: string[]): Promise<SelectTask[]> {
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(tasks).where(inArray(tasks.id, ids));
}

/* v8 ignore next */
async function defaultGetStagesByIds(ids: string[]): Promise<SelectPipelineStageInstance[]> {
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(pipelineStageInstances).where(inArray(pipelineStageInstances.id, ids));
}

/* v8 ignore next */
async function defaultGetChangeRequestById(id: string): Promise<SelectChangeRequest | null> {
  const rows = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetStagesByRunIds(runIds: string[]): Promise<SelectPipelineStageInstance[]> {
  if (runIds.length === 0) {
    return [];
  }

  return db.select().from(pipelineStageInstances).where(inArray(pipelineStageInstances.runId, runIds));
}

/* v8 ignore next */
async function defaultGetCandidatesForDepartment(
  workspaceId: string,
  departmentOrRole: string
): Promise<AssigneeCandidate[]> {
  const rows = await db.select().from(users).where(eq(users.workspaceId, workspaceId));
  return rows
    .filter((user) => user.skills.includes(departmentOrRole) || user.role === 'dev' || user.role === 'designer')
    .map((user) => ({ ...user, loadScore: 0 }));
}

/* v8 ignore next */
async function defaultUpdateTask(id: string, data: Partial<InsertTask>): Promise<void> {
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}

/* v8 ignore next */
async function defaultUpdateChangeRequest(id: string, data: Partial<InsertChangeRequest>): Promise<void> {
  await db.update(changeRequests).set(data).where(eq(changeRequests.id, id));
}

/* v8 ignore next */
async function defaultGetUserById(id: string): Promise<SelectUser | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}
