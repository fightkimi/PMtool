import { describe, expect, it, vi } from 'vitest';
import { PipelineInstantiator } from '@/agents/zhongshu/PipelineInstantiator';
import { ZhongShuAgent } from '@/agents/zhongshu/ZhongShuAgent';
import type { AgentMessage } from '@/agents/base/types';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type {
  InsertPipelineStageInstance,
  SelectPipeline,
  SelectPipelineRun,
  SelectProject,
  SelectTask
} from '@/lib/schema';

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: null,
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
  dueAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const baseMessage: AgentMessage = {
  id: 'msg-1',
  from: 'zhongshui',
  to: 'zhongshu',
  type: 'request',
  payload: {
    project_id: 'project-1',
    content: '请拆解这个需求',
    source: 'text'
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

function createRegistry(aiResponse: string) {
  const im: IMAdapter = {
    sendMessage: vi.fn(),
    sendMarkdown: vi.fn(),
    sendCard: vi.fn(),
    sendDM: vi.fn(),
    parseIncoming: vi.fn(),
    getGroupMembers: vi.fn()
  };
  const ai: AIAdapter = {
    chat: vi.fn().mockResolvedValue({ content: aiResponse, inputTokens: 10, outputTokens: 10 }),
    stream: vi.fn()
  };

  return {
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    ai
  };
}

function createTaskResult(ids: string[]): SelectTask[] {
  return ids.map((id, index) => ({
    id,
    projectId: 'project-1',
    parentId: null,
    title: `Task ${index + 1}`,
    description: 'desc',
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
    acceptanceCriteria: [],
    tableRecordId: null,
    dueAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
}

const pipelineTemplate: SelectPipeline = {
  id: 'pipeline-1',
  workspaceId: 'workspace-1',
  name: 'UI 标准模板',
  businessType: 'ui',
  complexityTier: 's',
  milestoneAnchors: [],
  totalWeeksDefault: 6,
  stages: [
    {
      stage_key: 'design',
      role_type: 'designer',
      name: 'Design',
      default_weeks: 2,
      depends_on: [],
      deliverables: [],
      can_parallel: false
    }
  ],
  historicalVelocities: {},
  isSystemTemplate: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

describe('ZhongShuAgent', () => {
  it('task mode inserts tasks and enqueues menxia review', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: 'A',
          description: 'A desc',
          acceptance_criteria: [],
          estimated_hours: 8,
          priority: 'medium',
          department: 'libu_li',
          dependencies: []
        },
        {
          title: 'B',
          description: 'B desc',
          acceptance_criteria: [],
          estimated_hours: 6,
          priority: 'high',
          department: 'libu_hu',
          dependencies: []
        },
        {
          title: 'C',
          description: 'C desc',
          acceptance_criteria: [],
          estimated_hours: 4,
          priority: 'low',
          department: 'libu_gong',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1', 't2', 't3']));
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    expect(batchInsertTasksMock).toHaveBeenCalledTimes(1);
    expect(batchInsertTasksMock.mock.calls[0]?.[0]).toHaveLength(3);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'menxia',
        payload: expect.objectContaining({
          mode: 'task',
          review_notes: []
        })
      })
    );
  });

  it('task mode appends cycle info to review notes', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: 'A',
          description: 'A desc',
          acceptance_criteria: [],
          estimated_hours: 8,
          priority: 'medium',
          department: 'libu_li',
          dependencies: ['B']
        },
        {
          title: 'B',
          description: 'B desc',
          acceptance_criteria: [],
          estimated_hours: 6,
          priority: 'high',
          department: 'libu_hu',
          dependencies: ['A']
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: vi.fn().mockResolvedValue(createTaskResult(['t1', 't2'])),
      queue: { enqueue },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          review_notes: expect.arrayContaining([expect.stringContaining('循环依赖')])
        })
      })
    );
  });

  it('pipeline mode instantiates matched templates and enqueues menxia', async () => {
    const aiJson = JSON.stringify({
      type: 'pipeline',
      deliverables: [
        { name: 'UI 1', business_type: 'ui', complexity_tier: 's', notes: 'first' },
        { name: 'UI 2', business_type: 'ui', complexity_tier: 's', notes: 'second' }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const instantiate = vi
      .fn()
      .mockResolvedValueOnce({ id: 'run-1' })
      .mockResolvedValueOnce({ id: 'run-2' });
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      queue: { enqueue },
      findPipelineTemplate: vi.fn().mockResolvedValue(pipelineTemplate),
      pipelineInstantiator: { instantiate },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    expect(instantiate).toHaveBeenCalledTimes(2);
    expect(instantiate).toHaveBeenNthCalledWith(1, pipelineTemplate, expect.objectContaining({ name: 'UI 1' }), 'project-1');
    expect(instantiate).toHaveBeenNthCalledWith(2, pipelineTemplate, expect.objectContaining({ name: 'UI 2' }), 'project-1');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'menxia',
        payload: expect.objectContaining({
          mode: 'pipeline',
          run_ids: ['run-1', 'run-2']
        })
      })
    );
  });

  it('PipelineInstantiator applies complexity factor when creating stages', async () => {
    const createPipelineRun = vi.fn().mockResolvedValue({
      id: 'run-1',
      pipelineId: 'pipeline-1',
      projectId: 'project-1',
      name: 'UI 套装',
      complexityTier: 's',
      status: 'planning',
      plannedEnd: null,
      actualEnd: null,
      versionTarget: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } satisfies SelectPipelineRun);
    const batchInsertStageInstances = vi.fn().mockResolvedValue(undefined);
    const instantiator = new PipelineInstantiator({
      createPipelineRun,
      batchInsertStageInstances,
      logger: { log: vi.fn(), error: vi.fn() }
    });

    await instantiator.instantiate(
      {
        ...pipelineTemplate,
        stages: [
          { ...pipelineTemplate.stages[0], stage_key: 'a', default_weeks: 2 },
          { ...pipelineTemplate.stages[0], stage_key: 'b', default_weeks: 3 },
          { ...pipelineTemplate.stages[0], stage_key: 'c', default_weeks: 1 }
        ]
      },
      {
        name: 'UI 套装',
        complexity_tier: 's',
        notes: 'notes'
      },
      'project-1'
    );

    const inserted = batchInsertStageInstances.mock.calls[0]?.[0] as InsertPipelineStageInstance[];
    expect(inserted).toHaveLength(3);
    expect(inserted.map((item) => item.estimatedHours)).toEqual(['12', '18', '6']);
  });

  it('AI prompt contains the full requirement analysis instructions', async () => {
    const aiJson = JSON.stringify({ type: 'task', tasks: [], review_notes: [] });
    const { registry, ai } = createRegistry(aiJson);
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: vi.fn().mockResolvedValue([]),
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    const messages = vi.mocked(ai.chat).mock.calls[0]?.[0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('判断规则');
    expect(messages[0].content).toContain('"pipeline"');
    expect(messages[0].content).toContain('"task"');
    expect(messages[0].content).toContain('"acceptance_criteria"');
    expect(messages[0].content).toContain('"deliverables"');
  });
});
