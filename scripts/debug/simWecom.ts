#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { AIModelAdapter } from '@/adapters/ai/AIModelAdapter';
import { getAllAliases, resolveModel } from '@/adapters/ai/providers';
import { parse as parseIntent, type IntentType } from '@/adapters/wecom/IntentParser';
import type { AIAdapter, AIMessage, AIOptions, AIResponse, IMAdapter, IMCard, IMMessage, IncomingMessage } from '@/adapters/types';
import { MenXiaAgent } from '@/agents/menxia/MenXiaAgent';
import { ShangShuAgent } from '@/agents/shangshu/ShangShuAgent';
import { ZhongShuAgent } from '@/agents/zhongshu/ZhongShuAgent';
import { ZhongshuiAgent } from '@/agents/zhongshui/ZhongshuiAgent';
import type { AgentMessage } from '@/agents/base/types';
import type {
  InsertAgentJob,
  InsertChangeRequest,
  InsertTask,
  PipelineBusinessType,
  PipelineComplexityTier,
  SelectAgentJob,
  SelectChangeRequest,
  SelectPipeline,
  SelectPipelineRun,
  SelectProject,
  SelectTask,
  SelectUser
} from '@/lib/schema';
import { agentLogger, type StructuredLogEntry } from '@/workers/logger';

loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });

type CliArgs = {
  projectId: string;
  message: string;
  rawLogFile?: string;
  realAi: boolean;
  smoke: boolean;
};

type MemoryState = {
  jobs: SelectAgentJob[];
  tasks: SelectTask[];
  runs: SelectPipelineRun[];
  changeRequests: SelectChangeRequest[];
  users: SelectUser[];
};

type ResultLog = StructuredLogEntry & {
  type: 'RESULT';
  summary: string;
};

type DebugUserSeed = {
  id: string;
  name: string;
  imUserId: string;
  role: SelectUser['role'];
  department: 'libu_li' | 'libu_hu' | 'libu_li2' | 'libu_bing' | 'libu_xing' | 'libu_gong';
  workHoursPerWeek: number;
};

const botName = process.env.WECOM_BOT_NAME ?? '助手';

const DEBUG_USERS: DebugUserSeed[] = [
  {
    id: 'debug-user-pm',
    name: '调试PM',
    imUserId: 'debug-im-pm',
    role: 'pm',
    department: 'libu_li',
    workHoursPerWeek: 40
  },
  {
    id: 'debug-user-dev',
    name: '调试开发',
    imUserId: 'debug-im-dev',
    role: 'dev',
    department: 'libu_gong',
    workHoursPerWeek: 40
  },
  {
    id: 'debug-user-qa',
    name: '调试测试',
    imUserId: 'debug-im-qa',
    role: 'qa',
    department: 'libu_xing',
    workHoursPerWeek: 40
  },
  {
    id: 'debug-user-designer',
    name: '调试设计',
    imUserId: 'debug-im-ui',
    role: 'designer',
    department: 'libu_li2',
    workHoursPerWeek: 40
  },
  {
    id: 'debug-user-manager',
    name: '调试管理',
    imUserId: 'debug-im-mgr',
    role: 'manager',
    department: 'libu_bing',
    workHoursPerWeek: 40
  }
];

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let projectId = '';
  let message = '';
  let rawLogFile = '';
  let realAi = false;
  let smoke = false;

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

    if (current === '--raw-log-file') {
      rawLogFile = args.shift() ?? '';
      continue;
    }

    if (current === '--real-ai') {
      realAi = true;
      continue;
    }

    if (current === '--smoke') {
      smoke = true;
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

  return { projectId, message, rawLogFile: rawLogFile || undefined, realAi, smoke };
}

function printUsage() {
  process.stderr.write(
    '用法：npx tsx scripts/debug/simWecom.ts --project [projectId] --msg "@助手 ..." [--raw-log-file /tmp/raw.json] [--real-ai] [--smoke]\n'
  );
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
    pmId: 'debug-user-pm',
    wecomGroupId: `debug-group:${projectId}`,
    wecomBotWebhook: `debug-wecom:${projectId}`,
    wecomMgmtGroupId: `debug-mgmt:${projectId}`,
    smartTableRootId: 'debug-root',
    taskTableWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=debug-task',
    pipelineTableWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=debug-pipeline',
    capacityTableWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=debug-capacity',
    riskTableWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=debug-risk',
    changeTableWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=debug-change',
  taskTableSchema: {},
  pipelineTableSchema: {},
  capacityTableSchema: {},
  riskTableSchema: {},
  changeTableSchema: {},
    githubRepo: 'fightkimi/PMtool',
    budget: { total: 100000, spent: 12000, token_budget: 5000 },
    startedAt: now,
    dueAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now
  };
}

function buildDebugUsers(): SelectUser[] {
  const now = new Date();

  return DEBUG_USERS.map((user) => ({
    id: user.id,
    workspaceId: 'debug-workspace',
    name: user.name,
    email: `${user.id}@example.com`,
    role: user.role,
    imUserId: user.imUserId,
    workHoursPerWeek: String(user.workHoursPerWeek),
    skills: [user.department],
    createdAt: now,
    updatedAt: now
  }));
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
    inputTokens: 423,
    outputTokens: 187
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
    inputTokens: 401,
    outputTokens: 143
  };
}

function generateChangeRequestEvaluation(content: string): AIResponse {
  const cleaned = stripBotMention(content).trim();
  let title = cleaned;
  let description = cleaned;

  try {
    const parsed = JSON.parse(cleaned) as { title?: string; description?: string };
    title = parsed.title?.trim() || title;
    description = parsed.description?.trim() || description;
  } catch {
    // Plain-text debug input is valid too.
  }

  return {
    content: JSON.stringify({
      affected_summary: `${title || description || '当前需求'} 预计影响任务拆解和排期评审`,
      days_impact: 3,
      risks: ['测试窗口被压缩', '交付节奏需要重新确认'],
      affected_task_ids: []
    }),
    inputTokens: 196,
    outputTokens: 92
  };
}

function generateReviewResult(): AIResponse {
  return {
    content: JSON.stringify({
      approved: true,
      issues: [],
      suggestions: []
    }),
    inputTokens: 154,
    outputTokens: 61
  };
}

function detectIntentFromText(text: string): IntentType {
  const parsed = normalizeIntentPayload(text);
  return parsed.intent === 'unknown' && /需求|功能|文档/u.test(text) ? 'parse_requirement' : parsed.intent;
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

function parseStructuredLog(args: unknown[]): StructuredLogEntry | null {
  if (args.length !== 1 || typeof args[0] !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(args[0]) as StructuredLogEntry;
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string' && typeof parsed.ts === 'string') {
      return parsed;
    }
  } catch {
    // Ignore non-JSON lines so the script can keep a small, clean log buffer.
  }

  return null;
}

function toOffsetLabel(baseTime: number, currentTs: string): string {
  const diffMs = Math.max(0, new Date(currentTs).getTime() - baseTime);
  const minutes = String(Math.floor(diffMs / 60_000)).padStart(2, '0');
  const seconds = String(Math.floor((diffMs % 60_000) / 1000)).padStart(2, '0');
  const millis = String(diffMs % 1000).padStart(3, '0');
  return `${minutes}:${seconds}.${millis}`;
}

function stringifyPreview(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatBlock(label: string, value: unknown): string[] {
  const serialized = stringifyPreview(value).split('\n');
  return [`${label}:`, ...serialized.map((line) => `  ${line}`)];
}

function buildEntryLines(entry: StructuredLogEntry | ResultLog): string[] {
  switch (entry.type) {
    case 'INTENT':
      return [
        String((entry as StructuredLogEntry & { intent?: unknown }).intent ?? ''),
        ...formatBlock('params', (entry as StructuredLogEntry & { params?: unknown }).params ?? {})
      ];
    case 'AGENT_START':
      return [
        `${String((entry as StructuredLogEntry & { from?: unknown }).from ?? '')} → ${String((entry as StructuredLogEntry & { to?: unknown }).to ?? '')}`,
        ...formatBlock('payload', (entry as StructuredLogEntry & { payload?: unknown }).payload ?? null)
      ];
    case 'AGENT_END': {
      const agentEntry = entry as StructuredLogEntry & {
        agentType?: string;
        status?: 'success' | 'failed';
        result?: unknown;
        error?: string;
      };
      return [
        `${agentEntry.agentType ?? 'unknown'} ${agentEntry.status === 'success' ? '✅ success' : '❌ failed'}`,
        ...(agentEntry.status === 'success'
          ? formatBlock('result', agentEntry.result ?? null)
          : [`error: ${agentEntry.error ?? 'unknown'}`])
      ];
    }
    case 'AI_CALL': {
      const aiEntry = entry as StructuredLogEntry & {
        agentType?: string;
        model?: string;
        promptPreview?: string;
        tokensIn?: number;
        tokensOut?: number;
        mocked?: boolean;
      };
      return [
        `${aiEntry.agentType ?? 'unknown'} [${aiEntry.model ?? 'unknown'}] ${aiEntry.mocked ? '(Mock)' : '(真实调用)'}`,
        `prompt: ${JSON.stringify(aiEntry.promptPreview ?? '')}`,
        `tokens: ${aiEntry.tokensIn ?? 0} in / ${aiEntry.tokensOut ?? 0} out`
      ];
    }
    case 'DB_WRITE': {
      const dbEntry = entry as StructuredLogEntry & {
        table?: string;
        operation?: string;
        recordCount?: number;
        preview?: unknown;
      };
      return [
        `${dbEntry.table ?? 'unknown'} ${dbEntry.operation ?? 'insert'} x${dbEntry.recordCount ?? 0}`,
        ...formatBlock('preview', dbEntry.preview ?? null)
      ];
    }
    case 'WECOM_OUT': {
      const wecomEntry = entry as StructuredLogEntry & {
        groupId?: string;
        messageType?: string;
        preview?: string;
      };
      return [
        `${wecomEntry.messageType ?? 'unknown'} → ${wecomEntry.groupId ?? 'unknown'}`,
        `preview: ${JSON.stringify(wecomEntry.preview ?? '')}`
      ];
    }
    case 'ERROR': {
      const errorEntry = entry as StructuredLogEntry & {
        agentType?: string;
        stage?: string;
        error?: string;
      };
      return [
        `${errorEntry.agentType ?? 'unknown'} @ ${errorEntry.stage ?? 'unknown'}`,
        `error: ${errorEntry.error ?? 'unknown'}`
      ];
    }
    case 'RESULT':
      return [(entry as ResultLog).summary];
    default:
      return [stringifyPreview(entry)];
  }
}

function getSortedLogs(logs: Array<StructuredLogEntry | ResultLog>): Array<StructuredLogEntry | ResultLog> {
  return [...logs]
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .filter((entry, index, items) => {
      if (index === 0 || entry.type !== 'AI_CALL') {
        return true;
      }

      const previous = items[index - 1];
      if (!previous || previous.type !== 'AI_CALL') {
        return true;
      }

      return JSON.stringify(previous) !== JSON.stringify(entry);
    });
}

function applyAiModeToLogs(logs: Array<StructuredLogEntry | ResultLog>, mocked: boolean): Array<StructuredLogEntry | ResultLog> {
  return logs.map((entry) => {
    if (entry.type !== 'AI_CALL') {
      return entry;
    }

    return {
      ...entry,
      mocked
    } as StructuredLogEntry;
  });
}

async function writeRawLogFile(path: string, logs: Array<StructuredLogEntry | ResultLog>) {
  const targetPath = resolve(process.cwd(), path);
  const parentDir = dirname(targetPath);
  await mkdir(parentDir, { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(logs, null, 2)}\n`, 'utf8');
}

function renderStructuredLogs(logs: Array<StructuredLogEntry | ResultLog>, originalLog: (...args: unknown[]) => void) {
  if (logs.length === 0) {
    originalLog('没有采集到结构化日志。');
    return;
  }

  const sorted = getSortedLogs(logs);
  const baseTime = new Date(sorted[0]!.ts).getTime();

  sorted.forEach((entry, index) => {
    const lines = buildEntryLines(entry);
    const branch = index === 0 ? '┌─' : index === sorted.length - 1 ? '└─' : '├─';
    const offset = toOffsetLabel(baseTime, entry.ts);
    const typeLabel = String(entry.type).padEnd(11, ' ');
    originalLog(`${branch} ${offset}  ${typeLabel} ${lines[0] ?? ''}`);
    lines.slice(1).forEach((line) => {
      originalLog(`│   ${line}`);
    });
  });

  originalLog('===== RAW LOG (复制以下内容用于排查) =====');
  originalLog(JSON.stringify(sorted));
  originalLog('==========================================');
}

async function main() {
  const { projectId, message, rawLogFile, realAi, smoke } = parseArgs(process.argv.slice(2));
  const originalConsoleLog = console.log.bind(console);
  const capturedLogs: Array<StructuredLogEntry | ResultLog> = [];

  console.log = (...args: unknown[]) => {
    const parsedLog = parseStructuredLog(args);
    if (parsedLog) {
      capturedLogs.push(parsedLog);
      return;
    }

    originalConsoleLog(...args);
  };

  const configuredRealModel = process.env.DEFAULT_AI_MODEL ?? (process.env.MINIMAX_API_KEY ? 'minimax' : 'claude');
  const resolvedRealModel = resolveModel(configuredRealModel);
  const realAiProviderName = resolvedRealModel?.provider.name ?? 'claude';
  console.log(
    realAi
      ? `[MODE] 使用真实 ${
          realAiProviderName === 'minimax'
            ? 'MiniMax'
            : realAiProviderName === 'zhipu'
              ? '智谱'
              : realAiProviderName === 'deepseek'
                ? 'DeepSeek'
                : 'Claude'
        } API，响应时间约 2-5 秒`
      : '[MODE] 使用 Mock AI（调试模式，响应瞬时）'
  );

  const project = buildProject(projectId);
  const incoming = buildIncomingMessage(projectId, message);
  const parsed = normalizeIntentPayload(incoming.text ?? '');
  const memory: MemoryState = {
    jobs: [],
    tasks: [],
    runs: [],
    changeRequests: [],
    users: buildDebugUsers()
  };

  const imAdapter: IMAdapter = {
    async sendMessage(groupId: string, text: string) {
      agentLogger.wecom(groupId, 'markdown', text);
    },
    async sendMarkdown(groupId: string, markdown: string) {
      agentLogger.wecom(groupId, 'markdown', markdown);
    },
    async sendCard(groupId: string, card: IMCard) {
      agentLogger.wecom(groupId, 'card', JSON.stringify(card));
    },
    async sendDM(userId: string, content: IMMessage) {
      agentLogger.wecom(userId, 'dm', JSON.stringify(content));
    },
    async parseIncoming() {
      return incoming;
    },
    async getGroupMembers() {
      return [];
    }
  };

  let aiAdapter: AIAdapter;
  if (realAi) {
    const defaultRealModel = process.env.DEFAULT_AI_MODEL ?? (process.env.MINIMAX_API_KEY ? 'minimax' : 'claude');
    const resolved = resolveModel(defaultRealModel);
    const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasMiniMax = Boolean(process.env.MINIMAX_API_KEY);
    const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
    const hasZhipu = Boolean(process.env.ZHIPU_API_KEY);

    if (!resolved) {
      throw new Error(`未知的真实模型：${defaultRealModel}。可用模型别名：${getAllAliases().join(', ')}`);
    }

    if (resolved.provider.name === 'minimax' && !hasMiniMax) {
      throw new Error('缺少 MINIMAX_API_KEY，无法启用 --real-ai 模式');
    }

    if (resolved.provider.name === 'claude' && !hasClaude) {
      throw new Error('缺少 ANTHROPIC_API_KEY，无法启用 --real-ai 模式');
    }

    if (resolved.provider.name === 'deepseek' && !hasDeepSeek) {
      throw new Error('缺少 DEEPSEEK_API_KEY，无法启用 --real-ai 模式');
    }

    if (resolved.provider.name === 'zhipu' && !hasZhipu) {
      throw new Error('缺少 ZHIPU_API_KEY，无法启用 --real-ai 模式');
    }

    if (!hasClaude && !hasMiniMax && !hasDeepSeek && !hasZhipu) {
      throw new Error('缺少可用的真实 AI Key，无法启用 --real-ai 模式');
    }

    aiAdapter = new AIModelAdapter({
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      minimaxApiKey: process.env.MINIMAX_API_KEY,
      minimaxModel: process.env.MINIMAX_MODEL
    });
  } else {
    aiAdapter = {
      async chat(messages: AIMessage[], options: AIOptions): Promise<AIResponse> {
        const systemPrompt = messages.find((item) => item.role === 'system')?.content ?? '';
        const userMessage = findLastUserMessage(messages);

        if (systemPrompt.includes('项目管理意图')) {
          const intent = detectIntentFromText(userMessage);
          agentLogger.aiCall('zhongshui', options.model ?? 'claude-sonnet-4-6', systemPrompt, 0, 0, true);
          return {
            content: intent,
            inputTokens: 0,
            outputTokens: 0
          };
        }

        if (systemPrompt.includes('分析以下需求变更对现有任务和排期的影响')) {
          const response = generateChangeRequestEvaluation(userMessage);
          agentLogger.aiCall(
            'menxia',
            options.model ?? 'claude-sonnet-4-6',
            systemPrompt,
            response.inputTokens,
            response.outputTokens,
            true
          );
          return response;
        }

        if (systemPrompt.includes('你是项目风险审查专家')) {
          const response = generateReviewResult();
          agentLogger.aiCall(
            'menxia',
            options.model ?? 'claude-sonnet-4-6',
            systemPrompt,
            response.inputTokens,
            response.outputTokens,
            true
          );
          return response;
        }

        const response = /皮肤|角色|关卡|UI改版|美术|建模|贴图|原画/u.test(userMessage)
          ? generatePipelineAnalysis(userMessage)
          : generateTaskAnalysis(userMessage);
        agentLogger.aiCall(
          'zhongshu',
          options.model ?? 'claude-sonnet-4-6',
          systemPrompt,
          response.inputTokens,
          response.outputTokens,
          true
        );
        return response;
      },
      async *stream() {
        yield 'debug';
        yield 'stream';
      }
    };
  }

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
      estimatedHours: task.estimatedHours == null ? null : Number(task.estimatedHours),
      actualHours: task.actualHours == null ? null : Number(task.actualHours),
      earliestStart: task.earliestStart ?? null,
      latestFinish: task.latestFinish ?? null,
      floatDays: task.floatDays == null ? null : Number(task.floatDays),
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

  const createChangeRequest = (rawText: string): SelectChangeRequest => {
    const now = new Date();
    const changeRequest: SelectChangeRequest = {
      id: randomUUID(),
      projectId,
      source: 'requirement',
      title: rawText.slice(0, 40) || '调试变更请求',
      description: rawText,
      requestedBy: null,
      status: 'draft',
      affectedTaskIds: [],
      affectedRunIds: [],
      scheduleImpactDays: 0,
      evaluationByAgent: null,
      cascadeExecutedAt: null,
      createdAt: now,
      updatedAt: now
    };
    memory.changeRequests.push(changeRequest);
    return changeRequest;
  };

  const updateChangeRequest = async (id: string, patch: Partial<InsertChangeRequest>): Promise<void> => {
    const changeRequest = memory.changeRequests.find((item) => item.id === id);
    if (!changeRequest) {
      return;
    }

    if (patch.affectedTaskIds !== undefined) {
      changeRequest.affectedTaskIds = patch.affectedTaskIds ?? [];
    }
    if (patch.affectedRunIds !== undefined) {
      changeRequest.affectedRunIds = patch.affectedRunIds ?? [];
    }
    if (patch.scheduleImpactDays !== undefined) {
      changeRequest.scheduleImpactDays = patch.scheduleImpactDays ?? 0;
    }
    if (patch.evaluationByAgent !== undefined) {
      changeRequest.evaluationByAgent = patch.evaluationByAgent ?? null;
    }
    if (patch.status !== undefined) {
      changeRequest.status = patch.status;
    }
    if (patch.cascadeExecutedAt !== undefined) {
      changeRequest.cascadeExecutedAt = patch.cascadeExecutedAt ?? null;
    }
    changeRequest.updatedAt = new Date();
  };

  const getOriginalContent = async (jobId: string, traceIds: string[] = []): Promise<string> => {
    const candidateJobIds = [jobId, ...traceIds];
    const originalJob = memory.jobs
      .filter((job) => candidateJobIds.includes(job.id) && job.agentType === 'zhongshu')
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .find((job) => {
        const payload = (job.input as { payload?: { content?: unknown; original_content?: unknown } }).payload;
        return typeof payload?.content === 'string' || typeof payload?.original_content === 'string';
      });

    const payload = (originalJob?.input as { payload?: { content?: unknown; original_content?: unknown } } | undefined)?.payload;
    if (typeof payload?.content === 'string' && payload.content.trim()) {
      return payload.content;
    }

    if (typeof payload?.original_content === 'string' && payload.original_content.trim()) {
      return payload.original_content;
    }

    return '（原始需求内容不可用，请根据 veto 反馈直接改进）';
  };

  let zhongShuAgent: ZhongShuAgent | null = null;
  let menXiaAgent: MenXiaAgent | null = null;
  let shangShuAgent: ShangShuAgent | null = null;

  const queue = {
    async enqueue(outbound: AgentMessage): Promise<string> {
      if (outbound.to === 'zhongshu' && zhongShuAgent) {
        await zhongShuAgent.run(outbound);
      }

      if (outbound.to === 'menxia' && menXiaAgent) {
        if (smoke) {
          return outbound.id;
        }

        const menxiaPayload = { ...(outbound.payload as Record<string, unknown>) };

        if (
          menxiaPayload.type === 'change_request' &&
          typeof menxiaPayload.description === 'string' &&
          !('change_request_id' in menxiaPayload)
        ) {
          const changeRequest = createChangeRequest(menxiaPayload.description);
          menxiaPayload.change_request_id = changeRequest.id;
        }

        await menXiaAgent.run({
          ...outbound,
          payload: menxiaPayload
        });
      }

      if (outbound.to === 'shangshu' && shangShuAgent) {
        if (smoke) {
          return outbound.id;
        }

        await shangShuAgent.run(outbound);
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
    getPMIMUserId: async () => 'debug-im-pm',
    batchInsertTasks,
    getOriginalContent,
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

  menXiaAgent = new MenXiaAgent({
    registry: adapterRegistry,
    queue,
    createAgentJob,
    updateAgentJob,
    getProjectById: async () => project,
    getPMIMUserId: async () => 'debug-pm-im',
    getChangeRequestById: async (id) => memory.changeRequests.find((item) => item.id === id) ?? null,
    updateChangeRequest,
    getTasksByIds: async (ids) => memory.tasks.filter((item) => ids.includes(item.id)),
    getStagesByIds: async () => [],
    getStagesByRunIds: async () => [],
    vetoStore: {
      async get() {
        return '0';
      },
      async set() {
        return 'OK';
      }
    },
    getWorkspaceMemberCount: async () => 5
  });

  shangShuAgent = new ShangShuAgent({
    registry: adapterRegistry,
    createAgentJob,
    updateAgentJob,
    getProjectById: async () => project,
    getPMIMUserId: async () => 'debug-im-pm',
    getTasksByIds: async (ids) => memory.tasks.filter((item) => ids.includes(item.id)),
    getStagesByIds: async () => [],
    getStagesByRunIds: async () => [],
    getTasksByAffectedIds: async (ids) => memory.tasks.filter((item) => ids.includes(item.id)),
    getCandidatesForDepartment: async (workspaceId, departmentOrRole) => {
      const matchingDebugUsers = DEBUG_USERS.filter((user) => user.department === departmentOrRole);
      const fallbackDebugUsers =
        matchingDebugUsers.length > 0 ? matchingDebugUsers : DEBUG_USERS.filter((user) => user.role === 'manager');

      return fallbackDebugUsers
        .map((debugUser) => memory.users.find((user) => user.id === debugUser.id))
        .filter((user): user is SelectUser => user != null && user.workspaceId === workspaceId)
        .map((user, index) => ({ ...user, loadScore: index }));
    },
    getUserById: async (id) => memory.users.find((item) => item.id === id) ?? null,
    updateTask: async (id, patch) => {
      const task = memory.tasks.find((item) => item.id === id);
      if (!task) {
        return;
      }

      if (patch.assigneeId !== undefined) {
        task.assigneeId = patch.assigneeId ?? null;
      }
      if (patch.dueAt !== undefined) {
        task.dueAt = patch.dueAt ?? null;
      }
      if (patch.status !== undefined) {
        task.status = patch.status;
      }
      if (patch.completedAt !== undefined) {
        task.completedAt = patch.completedAt ?? null;
      }
      task.updatedAt = new Date();
    },
    batchUpdateStages: async () => undefined,
    updateChangeRequest,
    syncPipelineTable: async () => undefined,
    syncTasksTable: async () => undefined
  });

  const zhongshuiAgent = new ZhongshuiAgent({
    registry: adapterRegistry,
    queue,
    createAgentJob,
    updateAgentJob,
    getProjectById: async () => project,
    getPMIMUserId: async () => 'debug-im-pm'
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

  agentLogger.intent(parsed.intent, parsed.params);

  try {
    await zhongshuiAgent.run(initialMessage);
    const uniqueAgents = new Set(
      capturedLogs
        .filter((entry) => entry.type === 'AGENT_END')
        .map((entry) => String((entry as StructuredLogEntry & { agentType?: unknown }).agentType ?? ''))
        .filter(Boolean)
    );
    const firstTs = capturedLogs[0]?.ts ? new Date(capturedLogs[0].ts).getTime() : Date.now();
    capturedLogs.push({
      type: 'RESULT',
      ts: new Date().toISOString(),
      summary: `全链路成功，共 ${uniqueAgents.size} 个 Agent，耗时 ${((Date.now() - firstTs) / 1000).toFixed(1)}s`
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    agentLogger.error('simWecom', 'main', err.message);
    capturedLogs.push({
      type: 'RESULT',
      ts: new Date().toISOString(),
      summary: `全链路失败，错误: ${err.message}`
    });
    process.exitCode = 1;
  } finally {
    console.log = originalConsoleLog;
    const normalizedLogs = applyAiModeToLogs(capturedLogs, !realAi);
    renderStructuredLogs(normalizedLogs, originalConsoleLog);
    if (rawLogFile) {
      try {
        await writeRawLogFile(rawLogFile, getSortedLogs(normalizedLogs));
        originalConsoleLog(`[RAW LOG FILE] ${resolve(process.cwd(), rawLogFile)}`);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        originalConsoleLog(`[RAW LOG FILE ERROR] ${err.message}`);
        process.exitCode = 1;
      }
    }
  }
}

void main();
