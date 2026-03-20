import Redis from 'ioredis';
import { and, eq, inArray } from 'drizzle-orm';
import { callAIWithRetry } from '@/agents/base/aiUtils';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import type { AgentMessage } from '@/agents/base/types';
import { detectCycle } from '@/agents/zhongshu/dagUtils';
import { db } from '@/lib/db';
import { extractJson } from '@/lib/parseJson';
import {
  changeRequests,
  pipelineStageInstances,
  tasks,
  users,
  type InsertChangeRequest,
  type SelectChangeRequest,
  type SelectPipelineStageInstance,
  type SelectTask
} from '@/lib/schema';
import { agentLogger } from '@/workers/logger';

type QueueLike = Pick<AgentQueue, 'enqueue'>;

type ReviewResult = {
  approved: boolean;
  issues: string[];
  suggestions: string[];
};

type ChangeRequestEvaluation = {
  affected_summary: string;
  days_impact: number;
  risks: string[];
  affected_task_ids?: string[];
};

type TaskWithDeps = SelectTask & { dependencies?: string[] };
type StageWithDeps = SelectPipelineStageInstance & { dependsOn?: string[] };

type VetoStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode: 'EX', ttlSeconds: number) => Promise<unknown>;
};

type MenXiaDeps = BaseAgentDeps & {
  queue?: QueueLike;
  getTasksByIds?: (ids: string[]) => Promise<TaskWithDeps[]>;
  getStagesByIds?: (ids: string[]) => Promise<StageWithDeps[]>;
  getStagesByRunIds?: (runIds: string[]) => Promise<StageWithDeps[]>;
  getChangeRequestById?: (id: string) => Promise<SelectChangeRequest | null>;
  updateChangeRequest?: (id: string, data: Partial<InsertChangeRequest>) => Promise<void>;
  vetoStore?: VetoStore;
  getWorkspaceMemberCount?: (workspaceId: string) => Promise<number>;
  now?: () => Date;
};

const REVIEW_PROMPT = `你是项目审查专家。检查任务计划的描述清晰度、工期合理性、工种完整性、依赖合理性。
返回 JSON：{"approved":boolean,"issues":[""],"suggestions":[""]}
只输出 JSON，不要解释。`;

const CHANGE_REQUEST_PROMPT =
  '分析以下需求变更对现有任务和排期的影响，识别受影响的任务，估算排期推迟天数，返回 JSON: {affected_summary, days_impact, risks}';

function createDefaultVetoStore(): VetoStore {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 0
  });

  return {
    get: async (key) => client.get(key),
    set: async (key, value, mode, ttlSeconds) => client.set(key, value, mode, ttlSeconds)
  };
}

function numericValue(value: number | string | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function daysBetween(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function normalizeReviewResult(value: unknown): ReviewResult {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    approved: typeof raw.approved === 'boolean' ? raw.approved : false,
    issues: normalizeStringArray(raw.issues),
    suggestions: normalizeStringArray(raw.suggestions)
  };
}

function createFallbackReviewResult(): ReviewResult {
  return {
    approved: false,
    issues: ['自动审核暂时不可用，请人工复核任务描述、工时与依赖关系。'],
    suggestions: ['补充更明确的需求背景、验收标准和依赖说明后重试。']
  };
}

function inferRiskLevel(issues: string[]): '高风险' | '中风险' | '低风险' {
  if (issues.length >= 4) {
    return '高风险';
  }

  if (issues.length >= 2) {
    return '中风险';
  }

  return '低风险';
}

function createReviewSummaryCardContent(issues: string[], suggestions: string[]): string {
  const risk = inferRiskLevel(issues);
  const riskIcon = risk === '高风险' ? '🔴' : risk === '中风险' ? '🟡' : '🟢';

  const issueList = issues.length > 0
    ? issues.slice(0, 3).map((item) => `· ${item}`).join('\n')
    : '· 当前未识别到明确问题，请人工复核';

  const suggestion = suggestions.length > 0
    ? suggestions[0]!
    : '补充更明确的需求背景、验收标准和依赖说明后重试';

  return `${riskIcon} ${risk}\n\n${issueList}\n\n💡 ${suggestion}\n\n👉 在群里重新发送修正后的需求，系统会重新拆解并审核。`;
}

function normalizeChangeRequestEvaluation(value: unknown): ChangeRequestEvaluation {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    affected_summary: typeof raw.affected_summary === 'string' ? raw.affected_summary : '',
    days_impact:
      typeof raw.days_impact === 'number'
        ? raw.days_impact
        : Number.parseFloat(String(raw.days_impact ?? '0')) || 0,
    risks: normalizeStringArray(raw.risks),
    affected_task_ids: Array.isArray(raw.affected_task_ids)
      ? raw.affected_task_ids.map((item) => String(item)).filter(Boolean)
      : []
  };
}

export class MenXiaAgent extends BaseAgent {
  readonly agentType = 'menxia' as const;

  private readonly queue: QueueLike;

  private readonly getTasksByIdsFn: (ids: string[]) => Promise<TaskWithDeps[]>;

  private readonly getStagesByIdsFn: (ids: string[]) => Promise<StageWithDeps[]>;

  private readonly getStagesByRunIdsFn: (runIds: string[]) => Promise<StageWithDeps[]>;

  private readonly getChangeRequestByIdFn: (id: string) => Promise<SelectChangeRequest | null>;

  private readonly updateChangeRequestFn: (id: string, data: Partial<InsertChangeRequest>) => Promise<void>;

  private readonly vetoStore: VetoStore;

  private readonly getWorkspaceMemberCountFn: (workspaceId: string) => Promise<number>;

  private readonly currentTime: () => Date;

  constructor(deps: MenXiaDeps = {}) {
    super(deps);
    this.queue = deps.queue ?? agentQueue;
    this.getTasksByIdsFn = deps.getTasksByIds ?? defaultGetTasksByIds;
    this.getStagesByIdsFn = deps.getStagesByIds ?? defaultGetStagesByIds;
    this.getStagesByRunIdsFn = deps.getStagesByRunIds ?? defaultGetStagesByRunIds;
    this.getChangeRequestByIdFn = deps.getChangeRequestById ?? defaultGetChangeRequestById;
    this.updateChangeRequestFn = deps.updateChangeRequest ?? defaultUpdateChangeRequest;
    this.vetoStore = deps.vetoStore ?? createDefaultVetoStore();
    this.getWorkspaceMemberCountFn = deps.getWorkspaceMemberCount ?? defaultGetWorkspaceMemberCount;
    this.currentTime = deps.now ?? (() => new Date());
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as Record<string, unknown>;

    if (typeof payload.change_request_id === 'string') {
      return this.handleChangeRequest(message, payload.change_request_id);
    }

    return this.handleReview(message);
  }

  private async handleReview(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as {
      mode: 'task' | 'pipeline';
      ids?: string[];
      run_ids?: string[];
      review_notes?: string[];
    };
    const projectId = message.context.project_id;
    if (!projectId) {
      throw new Error('project_id is required');
    }

    const project = await this.getProject(projectId);
    const reviewNotes = payload.review_notes ?? [];

    let issues: string[] = [];
    let reviewPayload: unknown[] = [];
    let downstreamIds: string[] = payload.ids ?? [];

    if (payload.mode === 'task') {
      const items = await this.getTasksByIdsFn(payload.ids ?? []);
      issues = await this.validateTasks(items, project);
      reviewPayload = items.map((task) => ({
        title: task.title,
        description: task.description ?? '',
        estimated_hours: numericValue(task.estimatedHours),
        dependencies: task.dependencies ?? []
      }));
    } else {
      const items =
        payload.ids && payload.ids.length > 0
          ? await this.getStagesByIdsFn(payload.ids)
          : await this.getStagesByRunIdsFn(payload.run_ids ?? []);
      downstreamIds = items.map((stage) => stage.id);
      issues = await this.validateStages(items, project);
      reviewPayload = items.map((stage) => ({
        title: stage.stageKey,
        description: stage.roleType,
        estimated_hours: numericValue(stage.estimatedHours),
        dependencies: stage.dependsOn ?? []
      }));
    }

    if (issues.length > 0) {
      return this.handleFailedReview(message, projectId, issues, []);
    }

    let aiResult: ReviewResult;
    try {
      aiResult = normalizeReviewResult(
        await callAIWithRetry(
          this.getAIAdapter(),
          [
            { role: 'system', content: REVIEW_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                mode: payload.mode,
                review_notes: reviewNotes,
                items: reviewPayload
              })
            }
          ],
          { agentType: this.agentType, temperature: 0.1, maxTokens: 220 },
          2
        )
      );
    } catch (error) {
      agentLogger.error(this.agentType, 'review_ai', error);
      const fallback = createFallbackReviewResult();
      return this.handleFailedReview(message, projectId, fallback.issues, fallback.suggestions);
    }

    if (!aiResult.approved && aiResult.issues.length === 0 && aiResult.suggestions.length === 0) {
      aiResult = createFallbackReviewResult();
    }

    const allIssues = [...issues, ...aiResult.issues];
    const approved = issues.length === 0 && aiResult.approved;

    if (approved) {
      const outbound = this.createMessage(
        'shangshu',
        {
          mode: payload.mode,
          ids: downstreamIds,
          project_id: projectId
        },
        message.context
      );
      await this.queue.enqueue(outbound);
      return outbound;
    }

    return this.handleFailedReview(message, projectId, allIssues, aiResult.suggestions);
  }

  private async handleFailedReview(
    message: AgentMessage,
    projectId: string,
    issues: string[],
    suggestions: string[]
  ): Promise<AgentMessage> {
    const key = `menxia:veto:${message.context.job_id}`;
    const currentCount = Number((await this.vetoStore.get(key)) ?? '0');
    const nextCount = currentCount + 1;
    await this.vetoStore.set(key, String(nextCount), 'EX', 3600);

    if (currentCount < 3) {
      const outbound = this.createMessage(
        'zhongshu',
        {
          issues,
          suggestions,
          project_id: projectId
        },
        message.context,
        2,
        'veto'
      );
      await this.queue.enqueue(outbound);
      await this.sendCard(projectId, {
        title: '⚠️ 计划审核未通过',
        content: createReviewSummaryCardContent(issues, suggestions)
      });
      return outbound;
    }

    const escalation = this.createMessage(
      'zhongshui',
      { reason: '多次否决未通过', issues, suggestions },
      message.context,
      1,
      'escalate'
    );
    await this.queue.enqueue(escalation);
    await this.sendPMCard(projectId, {
      title: '计划需要人工介入',
      content: issues.join('\n') || '门下省多次否决，需人工处理。'
    });
    return escalation;
  }

  private async handleChangeRequest(message: AgentMessage, changeRequestId: string): Promise<AgentMessage> {
    const changeRequest = await this.getChangeRequestByIdFn(changeRequestId);
    if (!changeRequest) {
      throw new Error(`ChangeRequest not found: ${changeRequestId}`);
    }

    const aiResponse = await this.getAIAdapter().chat(
      [
        { role: 'system', content: CHANGE_REQUEST_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            title: changeRequest.title,
            description: changeRequest.description,
            project_id: changeRequest.projectId
          })
        }
      ],
      { agentType: this.agentType, temperature: 0.1, maxTokens: 200 }
    );
    const parsed = normalizeChangeRequestEvaluation(extractJson(aiResponse.content));

    await this.updateChangeRequestFn(changeRequestId, {
      affectedTaskIds: parsed.affected_task_ids ?? [],
      scheduleImpactDays: parsed.days_impact,
      evaluationByAgent: parsed,
      status: 'evaluating'
    });
    agentLogger.dbWrite('change_requests', 'update', 1, { schedule_impact_days: parsed.days_impact });

    await this.sendCard(changeRequest.projectId, {
      title: '📋 变更评估结果',
      content: `**影响范围**：${parsed.affected_summary}\n**排期影响**：+${parsed.days_impact} 天\n**风险点**：${(parsed.risks ?? []).join('、')}`,
      buttons: [
        { text: '✅ 确认执行', action: `change_confirmed:${changeRequestId}` },
        { text: '❌ 取消变更', action: `change_cancelled:${changeRequestId}` }
      ]
    });

    return this.createMessage(
      'menxia',
      {
        change_request_id: changeRequestId,
        status: 'evaluating'
      },
      {
        ...message.context,
        project_id: changeRequest.projectId
      },
      2,
      'response'
    );
  }

  private async validateTasks(items: TaskWithDeps[], project: Awaited<ReturnType<BaseAgent['getProject']>>): Promise<string[]> {
    const issues: string[] = [];

    for (const task of items) {
      if (!task.title || task.estimatedHours == null) {
        issues.push(`任务 ${task.title || task.id} 缺少必填字段`);
      }

      const hours = numericValue(task.estimatedHours);
      if (hours < 0.5 || hours > 80) {
        issues.push(`任务 ${task.title} 的 estimated_hours 超出合理范围`);
      }
    }

    const cycle = detectCycle(
      items.map((task) => task.title),
      new Map(items.map((task) => [task.title, task.dependencies ?? []]))
    );
    if (cycle) {
      issues.push(`检测到循环依赖: ${cycle.join(' -> ')}`);
    }

    if (await this.exceedsCapacity(project, items.map((task) => numericValue(task.estimatedHours)))) {
      issues.push('任务总工时超过项目剩余容量');
    }

    return issues;
  }

  private async validateStages(items: StageWithDeps[], project: Awaited<ReturnType<BaseAgent['getProject']>>): Promise<string[]> {
    const issues: string[] = [];

    for (const stage of items) {
      if (!stage.stageKey || !stage.roleType) {
        issues.push(`阶段 ${stage.stageKey || stage.id} 缺少必填字段`);
      }

      const hours = numericValue(stage.estimatedHours);
      if (hours < 0.5 || hours > 80) {
        issues.push(`阶段 ${stage.stageKey} 的 estimated_hours 超出合理范围`);
      }
    }

    const cycle = detectCycle(
      items.map((stage) => stage.stageKey),
      new Map(items.map((stage) => [stage.stageKey, stage.dependsOn ?? []]))
    );
    if (cycle) {
      issues.push(`检测到循环依赖: ${cycle.join(' -> ')}`);
    }

    if (await this.exceedsCapacity(project, items.map((stage) => numericValue(stage.estimatedHours)))) {
      issues.push('阶段总工时超过项目剩余容量');
    }

    return issues;
  }

  private async exceedsCapacity(
    project: Awaited<ReturnType<BaseAgent['getProject']>>,
    hours: number[]
  ): Promise<boolean> {
    if (!project.dueAt) {
      return false;
    }

    const memberCount = await this.getWorkspaceMemberCountFn(project.workspaceId);
    const remainingDays = daysBetween(this.currentTime(), project.dueAt);
    const capacity = remainingDays * memberCount * 6;
    const totalHours = hours.reduce((sum, value) => sum + value, 0);

    return totalHours > capacity;
  }
}

const menXiaAgent = new MenXiaAgent();

export default menXiaAgent;

/* v8 ignore next */
async function defaultGetTasksByIds(ids: string[]): Promise<TaskWithDeps[]> {
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(tasks).where(inArray(tasks.id, ids));
}

/* v8 ignore next */
async function defaultGetStagesByIds(ids: string[]): Promise<StageWithDeps[]> {
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(pipelineStageInstances).where(inArray(pipelineStageInstances.id, ids));
}

/* v8 ignore next */
async function defaultGetStagesByRunIds(runIds: string[]): Promise<StageWithDeps[]> {
  if (runIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(pipelineStageInstances)
    .where(inArray(pipelineStageInstances.runId, runIds));
}

/* v8 ignore next */
async function defaultGetChangeRequestById(id: string): Promise<SelectChangeRequest | null> {
  const rows = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultUpdateChangeRequest(id: string, data: Partial<InsertChangeRequest>): Promise<void> {
  await db.update(changeRequests).set(data).where(eq(changeRequests.id, id));
}

/* v8 ignore next */
async function defaultGetWorkspaceMemberCount(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.workspaceId, workspaceId));
  return rows.length;
}
