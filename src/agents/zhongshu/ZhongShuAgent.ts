import { and, eq } from 'drizzle-orm';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import { PipelineInstantiator } from '@/agents/zhongshu/PipelineInstantiator';
import { detectCycle } from '@/agents/zhongshu/dagUtils';
import { db } from '@/lib/db';
import { batchInsertTasks } from '@/lib/queries/tasks';
import {
  pipelines,
  type InsertTask,
  type PipelineBusinessType,
  type PipelineComplexityTier,
  type SelectPipeline,
  type SelectPipelineRun,
  type SelectTask
} from '@/lib/schema';

type QueueLike = Pick<AgentQueue, 'enqueue'>;

type ParsedTask = {
  title: string;
  description: string;
  acceptance_criteria: string[];
  estimated_hours: number;
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
};

const REQUIREMENT_ANALYSIS_PROMPT = `你是项目管理专家。请分析以下项目需求，判断类型并结构化输出。

判断规则：
- 包含"皮肤""角色""关卡""UI改版""美术""建模""贴图""原画"等词 → type: "pipeline"
- 其他（功能需求、系统需求、技术需求）→ type: "task"

type: "task" 输出格式：
{
  "type": "task",
  "tasks": [{
    "title": string（不超过30字）,
    "description": string,
    "acceptance_criteria": string[],
    "estimated_hours": number,
    "priority": "critical"|"high"|"medium"|"low",
    "department": "libu_li"|"libu_hu"|"libu_li2"|"libu_bing"|"libu_xing"|"libu_gong",
    "dependencies": string[]
  }],
  "review_notes": string[]
}

type: "pipeline" 输出格式：
{
  "type": "pipeline",
  "deliverables": [{
    "name": string,
    "business_type": "ui"|"skin"|"character"|"weapon"|"level"|"custom",
    "complexity_tier": "s_plus"|"s"|"a"|"b",
    "notes": string
  }],
  "review_notes": string[]
}

严格返回 JSON，不要其他内容。如发现歧义，必须在 review_notes 中说明，不要自行假设。`;

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

  constructor(deps: ZhongShuDeps = {}) {
    super(deps);
    this.queue = deps.queue ?? agentQueue;
    this.batchInsertTasksFn = deps.batchInsertTasks ?? batchInsertTasks;
    this.findPipelineTemplateFn = deps.findPipelineTemplate ?? defaultFindPipelineTemplate;
    this.pipelineInstantiator = deps.pipelineInstantiator ?? new PipelineInstantiator();
    this.tableSync = deps.tableSync ?? tableSyncPlaceholder;
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as {
      project_id?: string;
      content?: string;
      source?: 'text' | 'document';
    };
    const projectId = payload.project_id ?? message.context.project_id;
    const content = payload.content ?? '';

    if (!projectId) {
      throw new Error('project_id is required');
    }

    const analysis = await this.analyzeRequirement(content);

    if (analysis.type === 'task') {
      return this.handleTaskMode(projectId, analysis, message);
    }

    return this.handlePipelineMode(projectId, analysis, message);
  }

  private async analyzeRequirement(content: string): Promise<ParsedRequirementResult> {
    const response = await this.getAIAdapter().chat(
      [
        { role: 'system', content: REQUIREMENT_ANALYSIS_PROMPT },
        { role: 'user', content }
      ],
      {}
    );

    return JSON.parse(response.content) as ParsedRequirementResult;
  }

  private async handleTaskMode(
    projectId: string,
    analysis: TaskModeResult,
    message: AgentMessage
  ): Promise<AgentMessage> {
    const taskInputs: InsertTask[] = analysis.tasks.map((task) => ({
      projectId,
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptance_criteria,
      estimatedHours: String(task.estimated_hours),
      priority: task.priority,
      department: task.department
    }));

    const insertedTasks = await this.batchInsertTasksFn(taskInputs);
    const reviewNotes = [...analysis.review_notes];

    const nodeTitles = analysis.tasks.map((task) => task.title);
    const edges = new Map<string, string[]>(
      analysis.tasks.map((task) => [task.title, task.dependencies])
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
    const reviewNotes = [...analysis.review_notes];
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

const zhongShuAgent = new ZhongShuAgent();

export default zhongShuAgent;

export { REQUIREMENT_ANALYSIS_PROMPT };
