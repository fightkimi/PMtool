import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import { db } from '@/lib/db';
import {
  changeRequests,
  pipelineRuns,
  pipelineStageInstances,
  risks,
  tasks,
  users,
  weeklyReports,
  type InsertWeeklyReport,
  type SelectChangeRequest,
  type SelectPipelineStageInstance,
  type SelectRisk,
  type SelectTask,
  type SelectUser
} from '@/lib/schema';

type LibuLi2Deps = BaseAgentDeps & {
  now?: () => Date;
  getCompletedTasks?: (projectId: string, from: Date, to: Date) => Promise<SelectTask[]>;
  getCompletedStages?: (projectId: string, from: Date, to: Date) => Promise<SelectPipelineStageInstance[]>;
  getUpcomingTasks?: (projectId: string, from: Date, to: Date) => Promise<SelectTask[]>;
  getUpcomingStages?: (projectId: string, from: Date, to: Date) => Promise<SelectPipelineStageInstance[]>;
  getNewRisks?: (projectId: string, from: Date, to: Date) => Promise<SelectRisk[]>;
  getOpenRisks?: (projectId: string) => Promise<SelectRisk[]>;
  getRecentChanges?: (projectId: string, from: Date, to: Date) => Promise<SelectChangeRequest[]>;
  getCriticalStages?: (projectId: string, from: Date, to: Date) => Promise<SelectPipelineStageInstance[]>;
  insertWeeklyReport?: (data: InsertWeeklyReport) => Promise<void>;
  getTaskById?: (id: string) => Promise<SelectTask | null>;
  getUserById?: (id: string) => Promise<SelectUser | null>;
  getChangeRequestById?: (id: string) => Promise<SelectChangeRequest | null>;
  getUsersByIds?: (ids: string[]) => Promise<SelectUser[]>;
};

const WEEKLY_REPORT_PROMPT = `你是项目周报助手。基于以下项目数据，生成适合 PM 阅读的简洁周报归纳（180字以内）。

数据：
{{PROJECT_DATA}}

格式（严格遵守，使用 markdown）：
**【上周完成】**
- 要点1

**【下周关键推进】**
- 要点1

**【PM需关注】**
- 要点1

要求：
1. 明确提到变更、关键路径、里程碑或风险中的核心信号；
2. 避免空话，优先写结果、偏差和下周动作；
3. 如果某一项没有内容，写“无”。`;

const statusLabelMap: Record<SelectTask['status'], string> = {
  todo: '待开始',
  in_progress: '进行中',
  blocked: '已阻塞',
  review: '待验收',
  done: '已完成',
  cancelled: '已取消'
};

function getWeekRange(base: Date) {
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function formatDate(value: Date | null | undefined): string {
  if (!value) {
    return '--/--';
  }

  return value.toISOString().slice(5, 10).replace('-', '/');
}

function summarizeBulletList(items: string[], emptyLabel = '无', limit = 3): string {
  if (items.length === 0) {
    return `- ${emptyLabel}`;
  }

  return items.slice(0, limit).map((item) => `- ${item}`).join('\n');
}

function sanitizeAiSummary(content: string): string {
  return content.trim() || '**【上周完成】**\n- 无\n\n**【下周关键推进】**\n- 无\n\n**【PM需关注】**\n- 无';
}

export class LibuLi2Agent extends BaseAgent {
  readonly agentType = 'libu_li2' as const;

  private readonly currentTime: () => Date;

  private readonly getCompletedTasksFn: (projectId: string, from: Date, to: Date) => Promise<SelectTask[]>;

  private readonly getCompletedStagesFn: (projectId: string, from: Date, to: Date) => Promise<SelectPipelineStageInstance[]>;

  private readonly getUpcomingTasksFn: (projectId: string, from: Date, to: Date) => Promise<SelectTask[]>;

  private readonly getUpcomingStagesFn: (projectId: string, from: Date, to: Date) => Promise<SelectPipelineStageInstance[]>;

  private readonly getNewRisksFn: (projectId: string, from: Date, to: Date) => Promise<SelectRisk[]>;

  private readonly getOpenRisksFn: (projectId: string) => Promise<SelectRisk[]>;

  private readonly getRecentChangesFn: (projectId: string, from: Date, to: Date) => Promise<SelectChangeRequest[]>;

  private readonly getCriticalStagesFn: (projectId: string, from: Date, to: Date) => Promise<SelectPipelineStageInstance[]>;

  private readonly insertWeeklyReportFn: (data: InsertWeeklyReport) => Promise<void>;

  private readonly getTaskByIdFn: (id: string) => Promise<SelectTask | null>;

  private readonly getUserByIdFn: (id: string) => Promise<SelectUser | null>;

  private readonly getChangeRequestByIdFn: (id: string) => Promise<SelectChangeRequest | null>;

  private readonly getUsersByIdsFn: (ids: string[]) => Promise<SelectUser[]>;

  constructor(deps: LibuLi2Deps = {}) {
    super(deps);
    this.currentTime = deps.now ?? (() => new Date());
    this.getCompletedTasksFn = deps.getCompletedTasks ?? defaultGetCompletedTasks;
    this.getCompletedStagesFn = deps.getCompletedStages ?? defaultGetCompletedStages;
    this.getUpcomingTasksFn = deps.getUpcomingTasks ?? defaultGetUpcomingTasksThisWeek;
    this.getUpcomingStagesFn = deps.getUpcomingStages ?? defaultGetUpcomingStagesThisWeek;
    this.getNewRisksFn = deps.getNewRisks ?? defaultGetNewRisks;
    this.getOpenRisksFn = deps.getOpenRisks ?? defaultGetOpenRisks;
    this.getRecentChangesFn = deps.getRecentChanges ?? defaultGetRecentChanges;
    this.getCriticalStagesFn = deps.getCriticalStages ?? defaultGetCriticalStagesThisWeek;
    this.insertWeeklyReportFn = deps.insertWeeklyReport ?? defaultInsertWeeklyReport;
    this.getTaskByIdFn = deps.getTaskById ?? defaultGetTaskById;
    this.getUserByIdFn = deps.getUserById ?? defaultGetUserById;
    this.getChangeRequestByIdFn = deps.getChangeRequestById ?? defaultGetChangeRequestById;
    this.getUsersByIdsFn = deps.getUsersByIds ?? defaultGetUsersByIds;
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as Record<string, unknown>;
    if (typeof payload.task_id === 'string') {
      return this.handleProgressUpdate(payload as { project_id: string; task_id: string; old_status: SelectTask['status']; new_status: SelectTask['status'] });
    }
    if (typeof payload.change_request_id === 'string' && Array.isArray(payload.affected_user_ids)) {
      return this.handleChangeNotification(payload as { change_request_id: string; affected_user_ids: string[] });
    }
    return this.handleWeeklyReport(payload as { project_id: string });
  }

  private async handleWeeklyReport(payload: { project_id: string }): Promise<AgentMessage> {
    const project = await this.getProject(payload.project_id);
    const now = this.currentTime();
    const currentWeek = getWeekRange(now);
    const lastWeekStart = new Date(currentWeek.monday);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(currentWeek.sunday);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);

    const completedTasks = await this.getCompletedTasksFn(project.id, lastWeekStart, lastWeekEnd);
    const completedStages = await this.getCompletedStagesFn(project.id, lastWeekStart, lastWeekEnd);
    const upcomingTasks = await this.getUpcomingTasksFn(project.id, currentWeek.monday, currentWeek.sunday);
    const upcomingStages = await this.getUpcomingStagesFn(project.id, currentWeek.monday, currentWeek.sunday);
    const newRisks = await this.getNewRisksFn(project.id, lastWeekStart, lastWeekEnd);
    const openRisks = await this.getOpenRisksFn(project.id);
    const recentChanges = await this.getRecentChangesFn(project.id, lastWeekStart, currentWeek.sunday);
    const criticalStages = await this.getCriticalStagesFn(project.id, currentWeek.monday, currentWeek.sunday);
    const milestoneRisks = openRisks.filter((risk) => risk.description.startsWith('里程碑风险：'));

    const promptData = {
      project_name: project.name,
      completed_tasks: completedTasks.map((task) => task.title),
      completed_stages: completedStages.map((stage) => stage.stageKey),
      upcoming_tasks: upcomingTasks.map((task) => task.title),
      upcoming_stages: upcomingStages.map((stage) => stage.stageKey),
      new_risks: newRisks.map((risk) => risk.description),
      open_risks: openRisks.map((risk) => ({ level: risk.level, description: risk.description })),
      recent_changes: recentChanges.map((change) => ({
        title: change.title,
        status: change.status,
        impact_days: change.scheduleImpactDays
      })),
      critical_path_stages: criticalStages.map((stage) => ({
        stage_key: stage.stageKey,
        due_at: stage.plannedEnd?.toISOString() ?? null,
        status: stage.status
      })),
      milestone_risks: milestoneRisks.map((risk) => risk.description)
    };

    const aiResponse = await this.getAIAdapter().chat(
      [
        { role: 'system', content: WEEKLY_REPORT_PROMPT },
        { role: 'user', content: JSON.stringify(promptData) }
      ],
      {}
    );

    const aiSummary = sanitizeAiSummary(aiResponse.content);
    const nextWeekActions = [
      recentChanges.length > 0 ? `优先确认 ${recentChanges.length} 项变更的影响面和执行窗口` : null,
      criticalStages.length > 0 ? `盯紧 ${criticalStages.length} 个关键路径阶段，避免本周排期漂移` : null,
      milestoneRisks.length > 0 ? `提前同步 ${milestoneRisks.length} 项里程碑偏差，准备资源或范围调整` : null,
      openRisks.length > 0 ? `推动 ${openRisks.length} 项开放风险明确责任人与关闭时间` : null,
      upcomingTasks.length > 0 ? `确认 ${upcomingTasks.length} 项本周到期任务的验收与交付节奏` : null
    ].filter((item): item is string => Boolean(item));

    const reportContent = [
      '【周度摘要】',
      `- 上周完成：任务 ${completedTasks.length} 项，阶段 ${completedStages.length} 项`,
      `- 本周到期：任务 ${upcomingTasks.length} 项，关键阶段 ${criticalStages.length} 项`,
      `- 风险与变更：开放风险 ${openRisks.length} 项，活跃变更 ${recentChanges.length} 项`,
      `- 里程碑信号：${milestoneRisks.length > 0 ? `${milestoneRisks.length} 项偏差预警` : '当前无新增偏差'}`,
      '',
      '【关键路径 / 里程碑】',
      summarizeBulletList(
        criticalStages.map((stage) => `${stage.stageKey} · ${formatDate(stage.plannedEnd)} · ${stage.status}`),
        '本周无关键路径压线阶段'
      ),
      summarizeBulletList(
        milestoneRisks.map((risk) => risk.description.replace(/^里程碑风险：/, '')),
        '暂无里程碑风险'
      ),
      '',
      '【变更与风险】',
      summarizeBulletList(
        recentChanges.map((change) => `${change.title} · ${change.status} · 影响 ${change.scheduleImpactDays} 天`),
        '本周暂无活跃变更'
      ),
      summarizeBulletList(
        openRisks.map((risk) => `${risk.description} · ${risk.level}`),
        '暂无开放风险'
      ),
      '',
      '【AI归纳】',
      aiSummary,
      '',
      '【下周 PM 动作】',
      summarizeBulletList(nextWeekActions, '维持当前节奏，按周会节点评审即可')
    ].join('\n');

    await this.sendCard(project.id, {
      title: `${project.name} 周报`,
      content: reportContent
    });
    await this.insertWeeklyReportFn({
      projectId: project.id,
      weekStart: lastWeekStart.toISOString().slice(0, 10),
      content: reportContent,
      generatedByAgent: true
    });

    return this.createMessage(
      'libu_li2',
      { project_id: project.id, content: reportContent },
      {
        workspace_id: project.workspaceId,
        project_id: project.id,
        job_id: `job-${Date.now()}`,
        trace_ids: []
      },
      2,
      'response'
    );
  }

  private async handleProgressUpdate(payload: {
    project_id: string;
    task_id: string;
    old_status: SelectTask['status'];
    new_status: SelectTask['status'];
  }): Promise<AgentMessage> {
    const project = await this.getProject(payload.project_id);
    const task = await this.getTaskByIdFn(payload.task_id);
    if (!task) {
      throw new Error(`Task not found: ${payload.task_id}`);
    }
    const assignee = task.assigneeId ? await this.getUserByIdFn(task.assigneeId) : null;

    await this.sendCard(project.id, {
      title: `${task.title} 进展同步`,
      content: [
        `状态：${statusLabelMap[payload.old_status]} → ${statusLabelMap[payload.new_status]}`,
        `负责人：${assignee?.name ?? '未分配'}`,
        `截止日期：${task.dueAt ? task.dueAt.toISOString().slice(5, 10).replace('-', '/') : '--/--'}`
      ].join('\n')
    });

    return this.createMessage(
      'libu_li2',
      { task_id: task.id, old_status: payload.old_status, new_status: payload.new_status },
      {
        workspace_id: project.workspaceId,
        project_id: project.id,
        job_id: `job-${Date.now()}`,
        trace_ids: []
      },
      2,
      'response'
    );
  }

  private async handleChangeNotification(payload: { change_request_id: string; affected_user_ids: string[] }): Promise<AgentMessage> {
    const changeRequest = await this.getChangeRequestByIdFn(payload.change_request_id);
    if (!changeRequest) {
      throw new Error(`ChangeRequest not found: ${payload.change_request_id}`);
    }
    const usersList = await this.getUsersByIdsFn(payload.affected_user_ids);
    for (const user of usersList) {
      if (!user.imUserId) {
        continue;
      }
      await this.getIMAdapter().sendDM(user.imUserId, {
        type: 'text',
        text: `${changeRequest.title} 截止时间调整：旧日期 MM/DD → 新日期 MM/DD（原因：${changeRequest.title}）`
      });
    }

    return this.createMessage(
      'libu_li2',
      { change_request_id: changeRequest.id, notified_users: usersList.map((user) => user.id) },
      {
        workspace_id: (await this.getProject(changeRequest.projectId)).workspaceId,
        project_id: changeRequest.projectId,
        job_id: `job-${Date.now()}`,
        trace_ids: []
      },
      2,
      'response'
    );
  }
}

const libuLi2Agent = new LibuLi2Agent();

export default libuLi2Agent;

/* v8 ignore next */
async function defaultGetCompletedTasks(projectId: string, from: Date, to: Date): Promise<SelectTask[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'done'), gte(tasks.completedAt, from), lte(tasks.completedAt, to)));
}

/* v8 ignore next */
async function defaultGetCompletedStages(projectId: string, from: Date, to: Date): Promise<SelectPipelineStageInstance[]> {
  const runs = await db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  if (runs.length === 0) {
    return [];
  }
  return db
    .select()
    .from(pipelineStageInstances)
    .where(
      and(
        inArray(pipelineStageInstances.runId, runs.map((run) => run.id)),
        eq(pipelineStageInstances.status, 'done'),
        gte(pipelineStageInstances.actualEnd, from),
        lte(pipelineStageInstances.actualEnd, to)
      )
    );
}

/* v8 ignore next */
async function defaultGetUpcomingTasksThisWeek(projectId: string, from: Date, to: Date): Promise<SelectTask[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), gte(tasks.dueAt, from), lte(tasks.dueAt, to)));
}

/* v8 ignore next */
async function defaultGetUpcomingStagesThisWeek(projectId: string, from: Date, to: Date): Promise<SelectPipelineStageInstance[]> {
  const runs = await db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  if (runs.length === 0) {
    return [];
  }
  return db
    .select()
    .from(pipelineStageInstances)
    .where(
      and(
        inArray(pipelineStageInstances.runId, runs.map((run) => run.id)),
        gte(pipelineStageInstances.plannedEnd, from),
        lte(pipelineStageInstances.plannedEnd, to),
        eq(pipelineStageInstances.status, 'pending')
      )
    );
}

/* v8 ignore next */
async function defaultGetNewRisks(projectId: string, from: Date, to: Date): Promise<SelectRisk[]> {
  return db
    .select()
    .from(risks)
    .where(and(eq(risks.projectId, projectId), gte(risks.createdAt, from), lte(risks.createdAt, to)));
}

/* v8 ignore next */
async function defaultGetOpenRisks(projectId: string): Promise<SelectRisk[]> {
  return db
    .select()
    .from(risks)
    .where(and(eq(risks.projectId, projectId), ne(risks.status, 'resolved')));
}

/* v8 ignore next */
async function defaultGetRecentChanges(projectId: string, from: Date, to: Date): Promise<SelectChangeRequest[]> {
  return db
    .select()
    .from(changeRequests)
    .where(and(eq(changeRequests.projectId, projectId), gte(changeRequests.createdAt, from), lte(changeRequests.createdAt, to)));
}

/* v8 ignore next */
async function defaultGetCriticalStagesThisWeek(projectId: string, from: Date, to: Date): Promise<SelectPipelineStageInstance[]> {
  const runRows = await db
    .select({
      id: pipelineRuns.id,
      pipelineId: pipelineRuns.pipelineId
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.projectId, projectId));

  if (runRows.length === 0) {
    return [];
  }

  const stageRows = await db
    .select()
    .from(pipelineStageInstances)
    .where(
      and(
        inArray(pipelineStageInstances.runId, runRows.map((run) => run.id)),
        gte(pipelineStageInstances.plannedEnd, from),
        lte(pipelineStageInstances.plannedEnd, to),
        ne(pipelineStageInstances.status, 'done')
      )
    );

  return stageRows.filter((stage) => Number(stage.floatDays ?? '0') === 0);
}

/* v8 ignore next */
async function defaultInsertWeeklyReport(data: InsertWeeklyReport): Promise<void> {
  await db.insert(weeklyReports).values(data);
}

/* v8 ignore next */
async function defaultGetTaskById(id: string): Promise<SelectTask | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetUserById(id: string): Promise<SelectUser | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetChangeRequestById(id: string): Promise<SelectChangeRequest | null> {
  const rows = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetUsersByIds(ids: string[]): Promise<SelectUser[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(users).where(inArray(users.id, ids));
}
