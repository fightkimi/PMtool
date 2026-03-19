import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/agents/base/types';
import { db } from '@/lib/db';
import { LibuBingAgent } from '@/agents/libu_bing/LibuBingAgent';
import type { IMAdapter, AIAdapter } from '@/adapters/types';
import type { SelectProject, SelectRisk, SelectTask, SelectUser, SelectPipelineStageInstance } from '@/lib/schema';

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: 'pm-1',
  wecomGroupId: 'group-1',
  wecomBotWebhook: 'https://example.com/hook',
  wecomMgmtGroupId: null,
  smartTableRootId: null,
  taskTableWebhook: null,
  pipelineTableWebhook: null,
  capacityTableWebhook: null,
  riskTableWebhook: null,
  changeTableWebhook: null,
  taskTableSchema: {},
  pipelineTableSchema: {},
  capacityTableSchema: {},
  riskTableSchema: {},
  changeTableSchema: {},
  githubRepo: null,
  budget: { total: 0, spent: 0, token_budget: 0 },
  startedAt: null,
  dueAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function createTask(overrides: Partial<SelectTask> = {}): SelectTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    parentId: null,
    title: '任务A',
    description: 'desc',
    status: 'blocked',
    priority: 'medium',
    assigneeId: 'u1',
    reviewerId: null,
    department: 'libu_li',
    estimatedHours: 8,
    actualHours: 8,
    earliestStart: null,
    latestFinish: null,
    floatDays: null,
    githubIssueNumber: null,
    acceptanceCriteria: [],
    tableRecordId: null,
    dueAt: new Date('2026-03-18T12:00:00Z'),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function createStage(overrides: Partial<SelectPipelineStageInstance> = {}): SelectPipelineStageInstance {
  return {
    id: 'stage-1',
    runId: 'run-1',
    stageKey: 'Design',
    roleType: 'designer',
    assigneeId: 'u1',
    plannedStart: new Date('2026-03-10T00:00:00Z'),
    plannedEnd: new Date('2026-03-16T00:00:00Z'),
    actualStart: null,
    actualEnd: null,
    estimatedHours: 16,
    dependsOn: [],
    floatDays: 0,
    status: 'pending',
    tableRecordId: null,
    taskId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function createAgent(overrides: {
  blockedTasks?: SelectTask[];
  delayedStages?: SelectPipelineStageInstance[];
  upcomingTasks?: SelectTask[];
  useDbRiskOps?: boolean;
} = {}) {
  const im: IMAdapter = {
    sendMessage: vi.fn(),
    sendMarkdown: vi.fn(),
    sendCard: vi.fn(),
    sendDM: vi.fn(),
    parseIncoming: vi.fn(),
    getGroupMembers: vi.fn()
  };
  const ai: AIAdapter = {
    chat: vi.fn(),
    stream: vi.fn()
  };

  const agent = new LibuBingAgent({
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    getProjectById: vi.fn().mockResolvedValue(projectFixture),
    createAgentJob: vi.fn(),
    updateAgentJob: vi.fn(),
    getPMIMUserId: vi.fn().mockResolvedValue('pm-im-1'),
    now: () => new Date('2026-03-17T00:00:00Z'),
    getBlockedTasks: vi.fn().mockResolvedValue(overrides.blockedTasks ?? []),
    getBlockedStages: vi.fn().mockResolvedValue([]),
    getDelayedCriticalStages: vi.fn().mockResolvedValue(overrides.delayedStages ?? []),
    getUpcomingTasks: vi
      .fn()
      .mockImplementation(async (_projectId: string, cutoff: Date, now: Date) =>
        (overrides.upcomingTasks ?? []).filter(
          (task) => task.dueAt != null && task.dueAt.getTime() < cutoff.getTime() && task.dueAt.getTime() >= now.getTime()
        )
      ),
    getVarianceTasks: vi.fn().mockResolvedValue([]),
    getRunsByProjectId: vi.fn().mockResolvedValue([]),
    getRiskByDescription: overrides.useDbRiskOps ? undefined : vi.fn().mockResolvedValue(null),
    createRisk: overrides.useDbRiskOps ? undefined : vi.fn().mockResolvedValue(undefined),
    updateRiskSeen: overrides.useDbRiskOps ? undefined : vi.fn().mockResolvedValue(undefined),
    getUserById: vi.fn().mockResolvedValue({ id: 'u1', name: 'User1', imUserId: 'im-u1' } as SelectUser)
  });

  return { agent, im };
}

describe('LibuBingAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends blocked task warning', async () => {
    const { agent, im } = createAgent({
      blockedTasks: [createTask({ title: '阻塞任务1' })]
    });

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_bing',
      type: 'request',
      payload: { project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(im.sendMarkdown).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.stringContaining('阻塞任务')
    );
  });

  it('sends critical path delay warning', async () => {
    const { agent, im } = createAgent({
      delayedStages: [createStage({ stageKey: 'UI', plannedEnd: new Date('2026-03-16T00:00:00Z') })]
    });

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_bing',
      type: 'request',
      payload: { project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(im.sendMarkdown).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.stringContaining('关键路径')
    );
  });

  it('warns only for tasks due within two days', async () => {
    const { agent, im } = createAgent({
      upcomingTasks: [
        createTask({ title: '近期待办', dueAt: new Date('2026-03-18T12:00:00Z'), status: 'in_progress' }),
        createTask({ id: 'task-2', title: '不提醒', dueAt: new Date('2026-03-20T00:00:00Z'), status: 'in_progress' })
      ]
    });

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_bing',
      type: 'request',
      payload: { project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    const messages = vi.mocked(im.sendMarkdown).mock.calls.map((call) => call[1]);
    expect(messages.some((message) => String(message).includes('即将逾期'))).toBe(true);
    expect(messages.some((message) => String(message).includes('不提醒'))).toBe(false);
  });

  it('deduplicates risks by updating last_seen_at on second scan', async () => {
    const fromMock = vi.fn();
    const whereMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'risk-1' } satisfies Partial<SelectRisk>]);
    fromMock.mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) } as never);
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) } as never);

    const { agent } = createAgent({
      blockedTasks: [createTask({ title: '重复风险' })],
      useDbRiskOps: true
    });
    const message: AgentMessage = {
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_bing',
      type: 'request',
      payload: { project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    };

    await agent.handle(message);
    await agent.handle(message);

    expect(db.update).toHaveBeenCalled();
  });
});
