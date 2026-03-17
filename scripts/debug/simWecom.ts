#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { parse as parseIntent, type IntentType } from '@/adapters/wecom/IntentParser';
import type { AIAdapter, AIMessage, AIOptions, AIResponse, IMAdapter, IMCard, IMMessage, IncomingMessage } from '@/adapters/types';
import { ZhongShuAgent } from '@/agents/zhongshu/ZhongShuAgent';
import { ZhongshuiAgent } from '@/agents/zhongshui/ZhongshuiAgent';
import type { AgentMessage, AgentType } from '@/agents/base/types';
import type {
  InsertAgentJob,
  InsertTask,
  PipelineBusinessType,
  PipelineComplexityTier,
  SelectAgentJob,
  SelectPipeline,
  SelectPipelineRun,
  SelectProject,
  SelectTask
} from '@/lib/schema';

loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });

type CliArgs = {
  projectId: string;
  message: string;
};

type MemoryState = {
  jobs: SelectAgentJob[];
  tasks: SelectTask[];
  wecomLogs: string[];
  runs: SelectPipelineRun[];
};

const botName = process.env.WECOM_BOT_NAME ?? '助手';

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let projectId = '';
  let message = '';

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--project') {
      projectId = args.shift() ?? '';
      continue;
    }

    if (current === '--msg') {
      message = args.shift() ?? '';
      continue;
    }

    if (current === '--help' || current === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!projectId || !message) {
    printUsage();
    process.exit(1);
  }

  return { projectId, message };
}

function printUsage() {
  console.error('用法：npx tsx scripts/debug/simWecom.ts --project [projectId] --msg "@助手 ..."');
}

function stripBotMention(message: string): string {
  return message
    .replace(new RegExp(`@${botName}`, 'g'), '')
    .replace(/^@\S+\s*/, '')
    .trim();
}

function buildIncomingMessage(projectId: string, message: string): IncomingMessage {
  return {
    type: 'text',
    userId: 'debug-user',
    groupId: `debug-group:${projectId}`,
    text: message,
    rawPayload: {
      debug: true,
      projectId,
      message
    }
  };
}

function normalizeIntentPayload(message: string): { intent: IntentType; params: Record<string, string> } {
  const parsed = parseIntent(message);
  const cleaned = stripBotMention(message);
  const sanitizedParams = { ...parsed.params };

  if (!sanitizedParams.text) {
    sanitizedParams.text = cleaned;
  }

  if (parsed.intent === 'parse_requirement') {
    const content =
      cleaned.replace(/^(分析需求|看看这个需求|分析一下|这个需求|需求文档)\s*[:：]?\s*/u, '').trim() || cleaned;
    return {
      intent: parsed.intent,
      params: {
        text: sanitizedParams.text,
        content
      }
    };
  }

  return {
    intent: parsed.intent,
    params: sanitizedParams
  };
}

function buildProject(projectId: string): SelectProject {
  const now = new Date();
  return {
    id: projectId,
    workspaceId: 'debug-workspace',
    name: `Debug Project ${projectId}`,
    type: 'custom',
    status: 'active',
    pmId: 'debug-pm',
    wecomGroupId: `debug-group:${projectId}`,
    wecomBotWebhook: `debug-wecom:${projectId}`,
    wecomMgmtGroupId: `debug-mgmt:${projectId}`,
    smartTableRootId: 'debug-root',
    taskTableId: 'debug-task-table',
    pipelineTableId: 'debug-pipeline-table',
    capacityTableId: 'debug-capacity-table',
    riskTableId: 'debug-risk-table',
    changeTableId: 'debug-change-table',
    githubRepo: 'fightkimi/PMtool',
    budget: { total: 100000, spent: 12000, token_budget: 5000 },
    startedAt: now,
    dueAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30),
    createdAt: now,
    updatedAt: now
  };
}

function createTaskTitle(content: string, fallback: string): string {
  const normalized = content.replace(/^[-*]\s*/, '').trim();
  return (normalized || fallback).slice(0, 30);
}

function generateTaskAnalysis(content: string): AIResponse {
  const cleaned = stripBotMention(content)
    .replace(/^(分析需求|看看这个需求|分析一下|这个需求|需求文档)\s*[:：]?\s*/u, '')
    .trim();
  const segments = cleaned
    .split(/[\n，,。；;]/u)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const base = [
    { title: createTaskTitle(segments[0] ?? '需求梳理', '需求梳理'), department: 'libu_li' },
    { title: createTaskTitle(segments[1] ?? '功能开发', '功能开发'), department: 'libu_gong' },
    { title: createTaskTitle(segments[2] ?? '测试验收', '测试验收'), department: 'libu_xing' }
  ] as const;

  const tasks = base.map((item, index) => ({
    title: item.title,
    description: `${item.title} - 来自调试脚本的模拟拆解`,
    acceptance_criteria: [`${item.title} 已完成`, `${item.title} 可被验收`],
    estimated_hours: [4, 12, 6][index],
    priority: ['high', 'medium', 'medium'][index] as 'high' | 'medium',
    department: item.department,
    dependencies: index === 0 ? [] : [base[index - 1].title]
  }));

  return {
    content: JSON.stringify({
      type: 'task',
      tasks,
      review_notes: []
    }),
    inputTokens: 0,
    outputTokens: 0
  };
}

function generatePipelineAnalysis(content: string): AIResponse {
  const cleaned = stripBotMention(content);
  const deliverableName = cleaned.replace(/^(分析需求|看看这个需求|分析一下)\s*[:：]?\s*/u, '').trim() || 'UI 交付物';

  return {
    content: JSON.stringify({
      type: 'pipeline',
      deliverables: [
        {
          name: deliverableName.slice(0, 30),
          business_type: 'ui',
          complexity_tier: 's',
          notes: '调试脚本自动生成的 UI 管线'
        }
      ],
      review_notes: []
    }),
    inputTokens: 0,
    outputTokens: 0
  };
}

function detectIntentFromText(text: string): IntentType {
  const parsed = normalizeIntentPayload(text);
  return parsed.intent === 'unknown' && /需求|功能|文档/u.test(text) ? 'parse_requirement' : parsed.intent;
}

function formatPayload(payload: Record<string, string>) {
  return inspect(payload, {
    depth: null,
    compact: true,
    breakLength: Infinity
  });
}

function findLastUserMessage(messages: AIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message.content;
    }
  }

  return '';
}

async function main() {
  const { projectId, message } = parseArgs(process.argv.slice(2));
  const project = buildProject(projectId);
  const incoming = buildIncomingMessage(projectId, message);
  const parsed = normalizeIntentPayload(incoming.text ?? '');
  const memory: MemoryState = {
    jobs: [],
    tasks: [],
    wecomLogs: [],
    runs: []
  };

  const imAdapter: IMAdapter = {
    async sendMessage(groupId: string, text: string) {
      memory.wecomLogs.push(`[WECOM 群消息] ${groupId}: ${text}`);
    },
    async sendMarkdown(groupId: string, markdown: string) {
      memory.wecomLogs.push(`[WECOM 群消息] ${groupId}: ${markdown}`);
    },
    async sendCard(groupId: string, card: IMCard) {
      memory.wecomLogs.push(`[WECOM 群卡片] ${groupId}: 标题：${card.title} 内容：${card.content}`);
    },
    async sendDM(userId: string, content: IMMessage) {
      if (content.type === 'text') {
        memory.wecomLogs.push(`[WECOM 私聊] ${userId}: ${content.text}`);
        return;
      }

      memory.wecomLogs.push(`[WECOM 私聊卡片] ${userId}: 标题：${content.card.title} 内容：${content.card.content}`);
    },
    async parseIncoming() {
      return incoming;
    },
    async getGroupMembers() {
      return [];
    }
  };

  const aiAdapter: AIAdapter = {
    async chat(messages: AIMessage[], options: AIOptions): Promise<AIResponse> {
      const systemPrompt = messages.find((item) => item.role === 'system')?.content ?? '';
      const userMessage = findLastUserMessage(messages);

      if (systemPrompt.includes('项目管理意图')) {
        const intent = detectIntentFromText(userMessage);
        options.onUsage?.({
          model: 'debug-mock',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0
        });
        return {
          content: intent,
          inputTokens: 0,
          outputTokens: 0
        };
      }

      const response = /皮肤|角色|关卡|UI改版|美术|建模|贴图|原画/u.test(userMessage)
        ? generatePipelineAnalysis(userMessage)
        : generateTaskAnalysis(userMessage);
      options.onUsage?.({
        model: 'debug-mock',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0
      });
      return response;
    },
    async *stream() {
      yield 'debug';
      yield 'stream';
    }
  };

  const adapterRegistry = {
    getIM: () => imAdapter,
    getAI: () => aiAdapter
  };

  const createAgentJob = async (data: InsertAgentJob): Promise<SelectAgentJob> => {
    const job: SelectAgentJob = {
      id: randomUUID(),
      workspaceId: data.workspaceId,
      agentType: data.agentType,
      trigger: data.trigger,
      input: data.input,
      output: data.output ?? null,
      status: data.status ?? 'pending',
      modelUsed: data.modelUsed ?? null,
      tokensInput: data.tokensInput ?? 0,
      tokensOutput: data.tokensOutput ?? 0,
      costUsd: typeof data.costUsd === 'string' ? data.costUsd : String(data.costUsd ?? '0'),
      errorMessage: data.errorMessage ?? null,
      startedAt: data.startedAt ?? null,
      finishedAt: data.finishedAt ?? null,
      createdAt: data.createdAt ?? new Date()
    };
    memory.jobs.push(job);
    return job;
  };

  const updateAgentJob = async (id: string, patch: Partial<InsertAgentJob>): Promise<void> => {
    const job = memory.jobs.find((item) => item.id === id);
    if (!job) {
      return;
    }

    if (patch.output !== undefined) {
      job.output = patch.output ?? null;
    }
    if (patch.status !== undefined) {
      job.status = patch.status;
    }
    if (patch.errorMessage !== undefined) {
      job.errorMessage = patch.errorMessage ?? null;
    }
    if (patch.finishedAt !== undefined) {
      job.finishedAt = patch.finishedAt ?? null;
    }
    if (patch.startedAt !== undefined) {
      job.startedAt = patch.startedAt ?? null;
    }
    if (patch.tokensInput !== undefined) {
      job.tokensInput = patch.tokensInput;
    }
    if (patch.tokensOutput !== undefined) {
      job.tokensOutput = patch.tokensOutput;
    }
    if (patch.costUsd !== undefined) {
      job.costUsd = typeof patch.costUsd === 'string' ? patch.costUsd : String(patch.costUsd);
    }
    if (patch.modelUsed !== undefined) {
      job.modelUsed = patch.modelUsed ?? null;
    }
  };

  const batchInsertTasks = async (taskInputs: InsertTask[]): Promise<SelectTask[]> => {
    const now = new Date();
    const inserted = taskInputs.map((task) => ({
      id: randomUUID(),
      projectId: task.projectId,
      parentId: task.parentId ?? null,
      title: task.title,
      description: task.description ?? null,
      status: task.status ?? 'todo',
      priority: task.priority ?? 'medium',
      assigneeId: task.assigneeId ?? null,
      reviewerId: task.reviewerId ?? null,
      department: task.department ?? null,
      estimatedHours:
        task.estimatedHours == null
          ? null
          : typeof task.estimatedHours === 'string'
            ? task.estimatedHours
            : String(task.estimatedHours),
      actualHours:
        task.actualHours == null ? null : typeof task.actualHours === 'string' ? task.actualHours : String(task.actualHours),
      earliestStart: task.earliestStart ?? null,
      latestFinish: task.latestFinish ?? null,
      floatDays: task.floatDays == null ? null : typeof task.floatDays === 'string' ? task.floatDays : String(task.floatDays),
      githubIssueNumber: task.githubIssueNumber ?? null,
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      tableRecordId: task.tableRecordId ?? null,
      dueAt: task.dueAt ?? null,
      completedAt: task.completedAt ?? null,
      createdAt: task.createdAt ?? now,
      updatedAt: task.updatedAt ?? now
    })) satisfies SelectTask[];

    memory.tasks.push(...inserted);
    return inserted;
  };

  const createMockPipeline = (
    businessType: PipelineBusinessType,
    complexityTier: PipelineComplexityTier
  ): SelectPipeline => ({
    id: randomUUID(),
    workspaceId: project.workspaceId,
    name: `Debug ${businessType} ${complexityTier}`,
    businessType,
    complexityTier,
    milestoneAnchors: [],
    totalWeeksDefault: 8,
    stages: [
      {
        stage_key: 'A1',
        role_type: 'planner',
        name: '需求',
        default_weeks: 1,
        depends_on: [],
        deliverables: ['需求稿'],
        can_parallel: false
      }
    ],
    historicalVelocities: {},
    isSystemTemplate: true,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  let zhongShuAgent: ZhongShuAgent | null = null;

  const queue = {
    async enqueue(outbound: AgentMessage): Promise<string> {
      console.log(`[AGENT] ${outbound.from} → ${outbound.to}`);

      if (outbound.to === 'zhongshu' && zhongShuAgent) {
        const beforeTaskCount = memory.tasks.length;
        const beforeRunCount = memory.runs.length;
        const result = await zhongShuAgent.run(outbound);

        const createdTaskCount = memory.tasks.length - beforeTaskCount;
        const createdRunCount = memory.runs.length - beforeRunCount;
        if (createdTaskCount > 0) {
          console.log(`[AGENT] zhongshu: 解析出 ${createdTaskCount} 个任务`);
        } else if (createdRunCount > 0) {
          console.log(`[AGENT] zhongshu: 实例化 ${createdRunCount} 条管线`);
        } else {
          console.log(`[AGENT] zhongshu: 已完成处理`);
        }

        const downstream = result.payload as Record<string, unknown>;
        if (Array.isArray(downstream.review_notes) && downstream.review_notes.length > 0) {
          console.log(`[AGENT] zhongshu review_notes: ${inspect(downstream.review_notes, { compact: true, breakLength: Infinity })}`);
        }
      }

      return outbound.id;
    }
  };

  zhongShuAgent = new ZhongShuAgent({
    registry: adapterRegistry,
    queue,
    createAgentJob,
    updateAgentJob,
    getProjectById: async () => project,
    getPMIMUserId: async () => 'debug-pm-im',
    batchInsertTasks,
    tableSync: {
      async batchSyncTasksToTable() {
        return;
      }
    },
    findPipelineTemplate: async (businessType, complexityTier) => createMockPipeline(businessType, complexityTier),
    pipelineInstantiator: {
      async instantiate(pipeline, deliverable, targetProjectId) {
        const run: SelectPipelineRun = {
          id: randomUUID(),
          pipelineId: pipeline.id,
          projectId: targetProjectId,
          name: deliverable.name,
          complexityTier: deliverable.complexity_tier,
          status: 'planning',
          plannedEnd: null,
          actualEnd: null,
          versionTarget: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        memory.runs.push(run);
        return run;
      }
    }
  });

  const zhongshuiAgent = new ZhongshuiAgent({
    registry: adapterRegistry,
    queue,
    createAgentJob,
    updateAgentJob,
    getProjectById: async () => project,
    getPMIMUserId: async () => 'debug-pm-im'
  });

  const initialMessage: AgentMessage = {
    id: randomUUID(),
    from: 'zhongshui',
    to: 'zhongshui',
    type: 'request',
    payload: {
      intent: parsed.intent,
      params: parsed.params,
      project_id: projectId
    },
    context: {
      workspace_id: project.workspaceId,
      project_id: projectId,
      job_id: `debug-root-${randomUUID()}`,
      trace_ids: []
    },
    priority: parsed.intent === 'change_request' || parsed.intent === 'risk_scan' ? 1 : 2,
    created_at: new Date().toISOString()
  };

  console.log(`[INTENT] ${parsed.intent} ${formatPayload(parsed.params)}`);

  try {
    const result = await zhongshuiAgent.run(initialMessage);

    for (const line of memory.wecomLogs) {
      console.log(line);
    }

    for (const job of memory.jobs) {
      const errorSuffix = job.errorMessage ? ` error=${job.errorMessage}` : '';
      console.log(`[JOB] ${job.agentType} ${job.status}${errorSuffix}`);
    }

    if (result.to !== 'zhongshu' && result.to !== 'menxia') {
      console.log(`[AGENT] ${result.to}: 已接收请求`);
    }

    console.log('[RESULT] 成功');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    for (const job of memory.jobs) {
      const errorSuffix = job.errorMessage ? ` error=${job.errorMessage}` : '';
      console.log(`[JOB] ${job.agentType} ${job.status}${errorSuffix}`);
    }
    console.error(`[RESULT] 失败 ${err.message}`);
    process.exitCode = 1;
  }
}

void main();
