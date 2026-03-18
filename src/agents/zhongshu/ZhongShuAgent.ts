import { and, eq, inArray } from 'drizzle-orm';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import { callAIWithRetry } from '@/agents/base/aiUtils';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import type { AIMessage } from '@/adapters/types';
import { PipelineInstantiator } from '@/agents/zhongshu/PipelineInstantiator';
import { detectCycle } from '@/agents/zhongshu/dagUtils';
import { db } from '@/lib/db';
import { extractJson } from '@/lib/parseJson';
import { batchInsertTasks } from '@/lib/queries/tasks';
import {
  agentJobs,
  pipelines,
  type InsertTask,
  type PipelineBusinessType,
  type PipelineComplexityTier,
  type SelectPipeline,
  type SelectPipelineRun,
  type SelectTask
} from '@/lib/schema';
import { agentLogger } from '@/workers/logger';

type QueueLike = Pick<AgentQueue, 'enqueue'>;

type ParsedTask = {
  title: string;
  description: string;
  acceptance_criteria: string[];
  estimated_hours: number | string;
  actual_hours?: number | string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  department: 'libu_li' | 'libu_hu' | 'libu_li2' | 'libu_bing' | 'libu_xing' | 'libu_gong';
  dependencies: string[];
};

type ParsedDeliverable = {
  name: string;
  business_type: PipelineBusinessType;
  complexity_tier: PipelineComplexityTier;
  notes: string;
};

type TaskModeResult = {
  type: 'task';
  tasks: ParsedTask[];
  review_notes: string[];
};

type PipelineModeResult = {
  type: 'pipeline';
  deliverables: ParsedDeliverable[];
  review_notes: string[];
};

type ParsedRequirementResult = TaskModeResult | PipelineModeResult;

type TableSync = {
  batchSyncTasksToTable: (projectId: string, tasks: SelectTask[]) => Promise<void>;
};

type ZhongShuDeps = BaseAgentDeps & {
  queue?: QueueLike;
  batchInsertTasks?: typeof batchInsertTasks;
  findPipelineTemplate?: (
    businessType: PipelineBusinessType,
    complexityTier: PipelineComplexityTier
  ) => Promise<SelectPipeline | null>;
  pipelineInstantiator?: Pick<PipelineInstantiator, 'instantiate'>;
  tableSync?: TableSync;
  getOriginalContent?: (jobId: string, traceIds?: string[]) => Promise<string>;
};

const REQUIREMENT_ANALYSIS_PROMPT =
  '你是项目管理专家。分析需求输出JSON。含"皮肤/角色/关卡/UI改版/美术/建模/贴图/原画"=>{"type":"pipeline","deliverables":[{"name":"","business_type":"ui","complexity_tier":"a","notes":""}],"review_notes":[]}；其他=>{"type":"task","tasks":[{"title":"","description":"","acceptance_criteria":[""],"estimated_hours":0,"priority":"high","department":"libu_gong","dependencies":[]}],"review_notes":[]}。只输出JSON，歧义写review_notes。不要思考过程，不要解释。';

function sanitizeRequirementContent(content: string): string {
  return content
    .replace(/^@\S+\s*/u, '')
    .replace(/^分析需求[，,:：\s]*/u, '')
    .trim();
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

function normalizeRequirementResult(raw: unknown): ParsedRequirementResult {
  const value = (raw ?? {}) as Record<string, unknown>;
  const type = value.type === 'pipeline' ? 'pipeline' : 'task';
  const reviewNotes = normalizeStringArray(value.review_notes);

  if (type === 'pipeline') {
    return {
      type,
      deliverables: Array.isArray(value.deliverables) ? (value.deliverables as ParsedDeliverable[]) : [],
      review_notes: reviewNotes
    };
  }

  return {
    type,
    tasks: Array.isArray(value.tasks) ? (value.tasks as ParsedTask[]) : [],
    review_notes: reviewNotes
  };
}

function splitRequirementSegments(content: string): string[] {
  return content
    .split(/[\n，、；;]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function inferDepartment(text: string): ParsedTask['department'] {
  const normalized = text.toLowerCase();

  if (/(测试|验收|qa|quality|回归|用例|test)/iu.test(normalized)) {
    return 'libu_xing';
  }

  if (/(ui|交互|视觉|设计|文案|原型|稿|样式)/iu.test(normalized)) {
    return 'libu_li2';
  }

  if (/(预算|成本|资源|采购|合同|报价)/iu.test(normalized)) {
    return 'libu_hu';
  }

  if (/(风险|阻塞|预警|里程碑|延期)/iu.test(normalized)) {
    return 'libu_bing';
  }

  if (/(开发|实现|接口|后端|前端|技术|脚本|部署|优化|异常|登录|功能)/iu.test(normalized)) {
    return 'libu_gong';
  }

  return 'libu_li';
}

function normalizeTask(content: string, task: ParsedTask): ParsedTask {
  const combined = `${task.title} ${task.description}`.trim();
  const inferredDepartment = inferDepartment(combined);
  const department =
    task.department === 'libu_li' && inferredDepartment !== 'libu_li' ? inferredDepartment : task.department;

  return {
    ...task,
    estimated_hours: parseFloat(String(task.estimated_hours)) || 0,
    actual_hours: task.actual_hours != null ? parseFloat(String(task.actual_hours)) : null,
    department
  };
}

function expandCombinedTasks(content: string, tasks: ParsedTask[]): ParsedTask[] {
  const segments = splitRequirementSegments(content);
  if (segments.length <= 1 || tasks.length !== 1) {
    return tasks.map((task) => normalizeTask(content, task));
  }

  const seedTask = tasks[0]!;
  return segments.map((segment, index) =>
    normalizeTask(content, {
      ...seedTask,
      title: segment.slice(0, 30),
      description: segment,
      acceptance_criteria:
        inferDepartment(segment) === 'libu_xing'
          ? [`${segment} 已完成`, `${segment} 已补充验收结果`]
          : [`${segment} 已完成`],
      estimated_hours:
        index === segments.length - 1
          ? Math.max(2, Math.round((parseFloat(String(seedTask.estimated_hours)) || 0) / segments.length))
          : Math.max(2, Math.round((parseFloat(String(seedTask.estimated_hours)) || 0) / segments.length)),
      department: inferDepartment(segment),
      dependencies: []
    })
  );
}

const tableSyncPlaceholder: TableSync = {
  async batchSyncTasksToTable(projectId: string, tasks: SelectTask[]) {
    console.log('TASK 09 placeholder: sync tasks to table', { projectId, taskCount: tasks.length });
  }
};

async function defaultFindPipelineTemplate(
  businessType: PipelineBusinessType,
  complexityTier: PipelineComplexityTier
): Promise<SelectPipeline | null> {
  const rows = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.businessType, businessType), eq(pipelines.complexityTier, complexityTier)));
  return rows[0] ?? null;
}

export class ZhongShuAgent extends BaseAgent {
  readonly agentType = 'zhongshu' as const;

  private readonly queue: QueueLike;

  private readonly batchInsertTasksFn: typeof batchInsertTasks;

  private readonly findPipelineTemplateFn: ZhongShuDeps['findPipelineTemplate'];

  private readonly pipelineInstantiator: Pick<PipelineInstantiator, 'instantiate'>;

  private readonly tableSync: TableSync;

  private readonly getOriginalContentFn: (jobId: string, traceIds?: string[]) => Promise<string>;

  constructor(deps: ZhongShuDeps = {}) {
    super(deps);
    this.queue = deps.queue ?? agentQueue;
    this.batchInsertTasksFn = deps.batchInsertTasks ?? batchInsertTasks;
    this.findPipelineTemplateFn = deps.findPipelineTemplate ?? defaultFindPipelineTemplate;
    this.pipelineInstantiator = deps.pipelineInstantiator ?? new PipelineInstantiator();
    this.tableSync = deps.tableSync ?? tableSyncPlaceholder;
    this.getOriginalContentFn = deps.getOriginalContent ?? defaultGetOriginalContent;
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    if (message.type === 'veto') {
      return this.handleVeto(message);
    }

    return this.handleNewRequest(message);
  }

  private async handleVeto(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as {
      issues?: string[];
      suggestions?: string[];
      project_id?: string;
      original_content?: string;
    };
    const projectId = payload.project_id ?? message.context.project_id;

    if (!projectId) {
      throw new Error('project_id is required');
    }

    const issues = normalizeStringArray(payload.issues);
    const suggestions = normalizeStringArray(payload.suggestions);

    if (issues.length === 0 && suggestions.length === 0) {
      return this.createMessage(
        'zhongshui',
        {
          project_id: projectId,
          status: 'ignored_empty_veto'
        },
        message.context,
        3,
        'response'
      );
    }

    return this.createMessage(
      'zhongshui',
      {
        project_id: projectId,
        status: 'awaiting_manual_revision',
        issues,
        suggestions
      },
      message.context,
      2,
      'response'
    );
  }

  private async handleNewRequest(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as {
      project_id?: string;
      content?: string;
      source?: 'text' | 'document' | 'retry';
      veto_context?: string;
    };
    const projectId = payload.project_id ?? message.context.project_id;
    const content = sanitizeRequirementContent(payload.content ?? '');

    if (!projectId) {
      throw new Error('project_id is required');
    }

    const analysis = await this.analyzeRequirement(content, payload.veto_context);

    if (analysis.type === 'task') {
      return this.handleTaskMode(projectId, analysis, message);
    }

    return this.handlePipelineMode(projectId, analysis, message);
  }

  private async analyzeRequirement(content: string, vetoContext?: string): Promise<ParsedRequirementResult> {
    const messages: AIMessage[] = [
      { role: 'system', content: REQUIREMENT_ANALYSIS_PROMPT },
      { role: 'user', content }
    ];
    if (vetoContext) {
      messages.push({ role: 'user', content: vetoContext });
    }

    return normalizeRequirementResult(
      await callAIWithRetry(
        this.getAIAdapter(),
        messages,
        {
          agentType: this.agentType,
          temperature: 0.3,
          maxTokens: 900
        },
        2
      )
    );
  }

  private async handleTaskMode(
    projectId: string,
    analysis: TaskModeResult,
    message: AgentMessage
  ): Promise<AgentMessage> {
    const content = sanitizeRequirementContent(String((message.payload as { content?: string }).content ?? ''));
    const normalizedTasks = expandCombinedTasks(content, analysis.tasks);

    const taskInputs: InsertTask[] = normalizedTasks.map((task) => ({
      projectId,
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptance_criteria,
      estimatedHours: parseFloat(String(task.estimated_hours)) || 0,
      actualHours: task.actual_hours != null ? parseFloat(String(task.actual_hours)) : null,
      priority: task.priority,
      department: task.department
    }));

    const insertedTasks = await this.batchInsertTasksFn(taskInputs);
    agentLogger.dbWrite('tasks', 'insert', insertedTasks.length, insertedTasks[0]);
    const reviewNotes = [...normalizeStringArray(analysis.review_notes)];

    const nodeTitles = normalizedTasks.map((task) => task.title);
    const edges = new Map<string, string[]>(
      normalizedTasks.map((task) => [task.title, task.dependencies])
    );
    const cycle = detectCycle(nodeTitles, edges);
    if (cycle) {
      reviewNotes.push(`检测到循环依赖: ${cycle.join(' -> ')}`);
    }

    await this.tableSync.batchSyncTasksToTable(projectId, insertedTasks);

    const outbound = this.createMessage(
      'menxia',
      {
        mode: 'task',
        ids: insertedTasks.map((task) => task.id),
        review_notes: reviewNotes
      },
      {
        workspace_id: message.context.workspace_id,
        project_id: projectId,
        job_id: message.context.job_id,
        trace_ids: [...message.context.trace_ids]
      }
    );

    await this.queue.enqueue(outbound);
    return outbound;
  }

  private async handlePipelineMode(
    projectId: string,
    analysis: PipelineModeResult,
    message: AgentMessage
  ): Promise<AgentMessage> {
    const reviewNotes = [...normalizeStringArray(analysis.review_notes)];
    const runs: SelectPipelineRun[] = [];

    for (const deliverable of analysis.deliverables) {
      const pipeline = await this.findPipelineTemplateFn?.(
        deliverable.business_type,
        deliverable.complexity_tier
      );

      if (!pipeline) {
        reviewNotes.push(
          `未找到匹配的 Pipeline 模板: ${deliverable.business_type}/${deliverable.complexity_tier}`
        );
        continue;
      }

      const run = await this.pipelineInstantiator.instantiate(pipeline, deliverable, projectId);
      runs.push(run);
      agentLogger.dbWrite('pipeline_runs', 'insert', 1, { run_id: run.id, name: run.name });
    }

    const outbound = this.createMessage(
      'menxia',
      {
        mode: 'pipeline',
        run_ids: runs.map((run) => run.id),
        review_notes: reviewNotes
      },
      {
        workspace_id: message.context.workspace_id,
        project_id: projectId,
        job_id: message.context.job_id,
        trace_ids: [...message.context.trace_ids]
      }
    );

    await this.queue.enqueue(outbound);
    return outbound;
  }
}

async function defaultGetOriginalContent(jobId: string, traceIds: string[] = []): Promise<string> {
  const candidateJobIds = [jobId, ...traceIds].filter(Boolean);
  if (candidateJobIds.length === 0) {
    return '（原始需求内容不可用，请根据 veto 反馈直接改进）';
  }

  const jobs = await db.select().from(agentJobs).where(inArray(agentJobs.id, candidateJobIds));
  const originalJob = jobs
    .filter((job) => job.agentType === 'zhongshu')
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .find((job) => {
      const input = job.input as { payload?: { content?: unknown; original_content?: unknown } };
      return typeof input.payload?.content === 'string' || typeof input.payload?.original_content === 'string';
    });

  const input = originalJob?.input as { payload?: { content?: unknown; original_content?: unknown } } | undefined;
  const content = input?.payload?.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }

  const originalContent = input?.payload?.original_content;
  if (typeof originalContent === 'string' && originalContent.trim()) {
    return originalContent;
  }

  return '（原始需求内容不可用，请根据 veto 反馈直接改进）';
}

const zhongShuAgent = new ZhongShuAgent();

export default zhongShuAgent;

export { REQUIREMENT_ANALYSIS_PROMPT };
