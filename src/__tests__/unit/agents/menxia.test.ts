import { describe, expect, it, vi } from 'vitest';
import { MenXiaAgent } from '@/agents/menxia/MenXiaAgent';
import type { AgentMessage } from '@/agents/base/types';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type { SelectChangeRequest, SelectProject, SelectTask } from '@/lib/schema';

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
  taskTableId: null,
  pipelineTableId: null,
  capacityTableId: null,
  riskTableId: null,
  changeTableId: null,
  githubRepo: null,
  budget: { total: 0, spent: 0, token_budget: 0 },
  startedAt: null,
  dueAt: new Date('2026-04-30T00:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date()
};

const reviewMessage: AgentMessage = {
  id: 'msg-1',
  from: 'zhongshu',
  to: 'menxia',
  type: 'request',
  payload: {
    mode: 'task',
    ids: ['task-1'],
    review_notes: []
  },
  context: {
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    job_id: 'job-1',
    trace_ids: []
  },
  priority: 2,
  created_at: new Date('2026-03-17T00:00:00Z').toISOString()
};

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    projectId: 'project-1',
    parentId: null,
    title: '任务A',
    description: '这是一个足够详细的任务描述',
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    reviewerId: null,
    department: 'libu_li',
    estimatedHours: '8',
    actualHours: null,
    earliestStart: null,
    latestFinish: null,
    floatDays: null,
    githubIssueNumber: null,
    acceptanceCriteria: ['完成'],
    tableRecordId: null,
    dueAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    dependencies: [],
    ...overrides
  };
}

function createAgent(options: {
  aiResponse?: string;
  tasks?: Array<SelectTask & { dependencies?: string[] }>;
  vetoCount?: number;
  changeRequest?: SelectChangeRequest | null;
} = {}) {
  const enqueue = vi.fn().mockResolvedValue('bull-job-1');
  const im: IMAdapter = {
    sendMessage: vi.fn(),
    sendMarkdown: vi.fn(),
    sendCard: vi.fn(),
    sendDM: vi.fn(),
    parseIncoming: vi.fn(),
    getGroupMembers: vi.fn()
  };
  const ai: AIAdapter = {
    chat: vi.fn().mockResolvedValue({
      content:
        options.aiResponse ??
        JSON.stringify({
          approved: true,
          issues: [],
          suggestions: []
        }),
      inputTokens: 10,
      outputTokens: 10
    }),
    stream: vi.fn()
  };
  const updateChangeRequest = vi.fn().mockResolvedValue(undefined);
  const vetoStore = {
    get: vi.fn().mockResolvedValue(String(options.vetoCount ?? 0)),
    set: vi.fn().mockResolvedValue('OK')
  };

  const agent = new MenXiaAgent({
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    queue: { enqueue },
    getTasksByIds: vi.fn().mockResolvedValue(options.tasks ?? [createTask()]),
    getProjectById: vi.fn().mockResolvedValue(projectFixture),
    createAgentJob: vi.fn(),
    updateAgentJob: vi.fn(),
    getPMIMUserId: vi.fn().mockResolvedValue('pm-im-1'),
    vetoStore,
    getWorkspaceMemberCount: vi.fn().mockResolvedValue(5),
    getChangeRequestById: vi.fn().mockResolvedValue(
      options.changeRequest ?? null
    ),
    updateChangeRequest
  });

  return { agent, enqueue, im, ai, updateChangeRequest, vetoStore };
}

describe('MenXiaAgent', () => {
  it('vetoes when estimated_hours exceeds range', async () => {
    const { agent, enqueue } = createAgent({
      tasks: [createTask({ title: '超大任务', estimatedHours: '100' }) as SelectTask & { dependencies?: string[] }]
    });

    await agent.handle(reviewMessage);

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'zhongshu',
        type: 'veto'
      })
    );
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'shangshu' }));
  });

  it('detects cycle dependency and vetoes', async () => {
    const { agent, enqueue } = createAgent({
      tasks: [
        createTask({ id: 'a', title: 'A', dependencies: ['B'] }) as SelectTask & { dependencies?: string[] },
        createTask({ id: 'b', title: 'B', dependencies: ['A'] }) as SelectTask & { dependencies?: string[] }
      ]
    });

    await agent.handle({ ...reviewMessage, payload: { ...reviewMessage.payload, ids: ['a', 'b'] } });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          issues: expect.arrayContaining([expect.stringContaining('循环依赖')])
        })
      })
    );
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'shangshu' }));
  });

  it('routes to shangshu when rules and AI both pass', async () => {
    const { agent, enqueue } = createAgent();

    await agent.handle(reviewMessage);

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'shangshu',
        type: 'request'
      })
    );
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'zhongshu' }));
  });

  it('escalates to zhongshui after veto count reaches limit', async () => {
    const { agent, enqueue, im } = createAgent({
      vetoCount: 3,
      tasks: [createTask({ title: '超大任务', estimatedHours: '100' }) as SelectTask & { dependencies?: string[] }]
    });

    await agent.handle(reviewMessage);

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'zhongshui',
        type: 'escalate'
      })
    );
    expect(im.sendDM).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'zhongshu', type: 'veto' }));
  });

  it('evaluates change request and notifies group', async () => {
    const changeRequest = {
      id: 'cr-1',
      projectId: 'project-1',
      source: 'requirement',
      title: '需求变更',
      description: '描述',
      requestedBy: null,
      status: 'draft',
      affectedTaskIds: [],
      affectedRunIds: [],
      scheduleImpactDays: 0,
      evaluationByAgent: null,
      cascadeExecutedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } satisfies SelectChangeRequest;
    const { agent, updateChangeRequest, im } = createAgent({
      changeRequest,
      aiResponse: JSON.stringify({
        affected_summary: '影响 2 个阶段',
        days_impact: 3,
        risks: ['QA时间压缩']
      })
    });

    await agent.handle({
      ...reviewMessage,
      payload: { change_request_id: 'cr-1' }
    });

    expect(updateChangeRequest).toHaveBeenCalledWith(
      'cr-1',
      expect.objectContaining({
        scheduleImpactDays: 3,
        status: 'evaluating'
      })
    );
    expect(im.sendCard).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        content: expect.stringContaining('+3 天'),
        buttons: expect.arrayContaining([
          expect.objectContaining({ action: 'change_confirmed:cr-1' })
        ])
      })
    );
  });
});
