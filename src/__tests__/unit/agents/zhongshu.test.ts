import { describe, expect, it, vi } from 'vitest';
import { PipelineInstantiator } from '@/agents/zhongshu/PipelineInstantiator';
import { REQUIREMENT_ANALYSIS_PROMPT, ZhongShuAgent } from '@/agents/zhongshu/ZhongShuAgent';
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
    estimatedHours: 8,
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
      getOriginalContent: vi.fn().mockResolvedValue('登录优化'),
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
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.not.objectContaining({
          original_content: expect.anything()
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

  it('converts estimatedHours to number before batch insert', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: 'A',
          description: 'A desc',
          acceptance_criteria: [],
          estimated_hours: '8',
          priority: 'medium',
          department: 'libu_li',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1']));
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    const insertedTask = batchInsertTasksMock.mock.calls[0]?.[0]?.[0];
    expect(typeof insertedTask?.estimatedHours).toBe('number');
    expect(insertedTask?.estimatedHours).toBe(8);
  });

  it('strips bot mention and analysis prefix before generating tasks', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '登录流程优化',
          description: '登录流程优化',
          acceptance_criteria: [],
          estimated_hours: 4,
          priority: 'medium',
          department: 'libu_gong',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1']));
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle({
      ...baseMessage,
      payload: {
        project_id: 'project-1',
        content: '@研发项目管理助手 分析需求，登录流程优化',
        source: 'text'
      }
    });

    expect(batchInsertTasksMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          title: '登录流程优化'
        })
      ])
    );
    expect(batchInsertTasksMock).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining('@研发项目管理助手')
        })
      ])
    );
  });

  it('parses fenced json returned by the model', async () => {
    const aiJson = `\`\`\`json
{
  "type": "task",
  "tasks": [
    {
      "title": "A",
      "description": "A desc",
      "acceptance_criteria": [],
      "estimated_hours": "8",
      "priority": "medium",
      "department": "libu_li",
      "dependencies": []
    }
  ],
  "review_notes": []
}
\`\`\``;
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1']));
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    expect(batchInsertTasksMock).toHaveBeenCalledTimes(1);
    expect(batchInsertTasksMock.mock.calls[0]?.[0]?.[0]).toEqual(
      expect.objectContaining({
        title: 'A',
        estimatedHours: 8
      })
    );
  });

  it('splits comma-separated requirements into independent tasks when model merges them', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '登录流程优化与异常提示补齐',
          description: '登录流程优化、补齐异常提示、增加验收测试',
          acceptance_criteria: [],
          estimated_hours: 24,
          priority: 'high',
          department: 'libu_li',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1', 't2', 't3']));
    const message = {
      ...baseMessage,
      payload: {
        project_id: 'project-1',
        content: '登录流程优化，补齐异常提示，增加验收测试',
        source: 'text'
      }
    } satisfies AgentMessage;
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(message);

    const insertedTasks = batchInsertTasksMock.mock.calls[0]?.[0] ?? [];
    expect(insertedTasks).toHaveLength(3);
    expect(insertedTasks.map((task: { title: string }) => task.title)).toEqual([
      '登录流程优化',
      '补齐异常提示',
      '增加验收测试'
    ]);
  });

  it('reassigns obvious implementation and testing work to matching departments', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '补齐异常提示',
          description: '前后端登录异常提示优化',
          acceptance_criteria: [],
          estimated_hours: 8,
          priority: 'high',
          department: 'libu_li',
          dependencies: []
        },
        {
          title: '增加验收测试',
          description: '补充登录验收测试与测试用例',
          acceptance_criteria: [],
          estimated_hours: 6,
          priority: 'medium',
          department: 'libu_li',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1', 't2']));
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    const insertedTasks = batchInsertTasksMock.mock.calls[0]?.[0] ?? [];
    expect(insertedTasks.map((task: { department: string }) => task.department)).toEqual(['libu_gong', 'libu_xing']);
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

  it('routes skin-like requirements to pipeline mode when AI returns pipeline', async () => {
    const aiJson = JSON.stringify({
      type: 'pipeline',
      deliverables: [{ name: '限定皮肤', business_type: 'skin', complexity_tier: 'a', notes: '皮肤制作' }],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const instantiate = vi.fn().mockResolvedValue({ id: 'run-skin-1' });
    const agent = new ZhongShuAgent({
      registry,
      queue: { enqueue },
      findPipelineTemplate: vi.fn().mockResolvedValue({ ...pipelineTemplate, businessType: 'skin', complexityTier: 'a' }),
      pipelineInstantiator: { instantiate },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle({
      ...baseMessage,
      payload: { ...baseMessage.payload, content: '做一个春节皮肤' }
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          run_ids: ['run-skin-1']
        })
      })
    );
  });

  it('routes feature requirements to task mode when AI returns task', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '登录流程优化',
          description: '优化登录流程',
          acceptance_criteria: ['登录成功率提升', '异常提示完整', '支持验收'],
          estimated_hours: 12,
          priority: 'high',
          department: 'libu_gong',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: vi.fn().mockResolvedValue(createTaskResult(['task-feature-1'])),
      queue: { enqueue },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle({
      ...baseMessage,
      payload: { ...baseMessage.payload, content: '优化登录功能' }
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          ids: ['task-feature-1']
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
    expect(inserted.map((item) => item.estimatedHours)).toEqual([12, 18, 6]);
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
    expect(messages[0].content).toContain('皮肤/角色/关卡/UI改版');
    expect(messages[0].content).toContain('"pipeline"');
    expect(messages[0].content).toContain('"task"');
    expect(messages[0].content).toContain('"acceptance_criteria"');
    expect(messages[0].content).toContain('"deliverables"');
  });

  it('keeps required task fields after prompt simplification', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '登录流程优化',
          description: '优化登录体验',
          acceptance_criteria: ['完成开发', '完成测试', '完成验收'],
          estimated_hours: 10,
          priority: 'high',
          department: 'libu_gong',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1']));
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.handle(baseMessage);

    expect(batchInsertTasksMock.mock.calls[0]?.[0]?.[0]).toEqual(
      expect.objectContaining({
        title: '登录流程优化',
        description: '优化登录体验',
        acceptanceCriteria: ['完成开发', '完成测试', '完成验收'],
        estimatedHours: 10,
        priority: 'high',
        department: 'libu_gong'
      })
    );
  });

  it('keeps requirement analysis prompt under 400 characters', () => {
    expect(REQUIREMENT_ANALYSIS_PROMPT.length).toBeLessThan(400);
  });

  it('wraps string review_notes into a single-item array instead of splitting characters', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '登录流程优化',
          description: '优化登录流程',
          acceptance_criteria: ['完成开发'],
          estimated_hours: 8,
          priority: 'high',
          department: 'libu_gong',
          dependencies: []
        }
      ],
      review_notes: '描述不清'
    });
    const { registry } = createRegistry(aiJson);
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: vi.fn().mockResolvedValue(createTaskResult(['t1'])),
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
          review_notes: ['描述不清']
        })
      })
    );
  });

  it('keeps array review_notes unchanged', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '登录流程优化',
          description: '优化登录流程',
          acceptance_criteria: ['完成开发'],
          estimated_hours: 8,
          priority: 'high',
          department: 'libu_gong',
          dependencies: []
        }
      ],
      review_notes: ['问题1', '问题2']
    });
    const { registry } = createRegistry(aiJson);
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: vi.fn().mockResolvedValue(createTaskResult(['t1'])),
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
          review_notes: ['问题1', '问题2']
        })
      })
    );
  });

  it('falls back to an empty task list when AI returns tasks as null', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: null,
      review_notes: []
    });
    const { registry } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue([]);
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue: vi.fn().mockResolvedValue('bull-job-1') },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await expect(agent.handle(baseMessage)).resolves.toEqual(
      expect.objectContaining({
        to: 'menxia'
      })
    );
    expect(batchInsertTasksMock).toHaveBeenCalledWith([]);
  });

  it('stops on actionable veto and returns manual revision guidance', async () => {
    const aiJson = JSON.stringify({
      type: 'task',
      tasks: [
        {
          title: '登录优化',
          description: '优化登录流程',
          acceptance_criteria: ['登录成功'],
          estimated_hours: 8,
          priority: 'high',
          department: 'libu_gong',
          dependencies: []
        }
      ],
      review_notes: []
    });
    const { registry, ai } = createRegistry(aiJson);
    const batchInsertTasksMock = vi.fn().mockResolvedValue(createTaskResult(['t1']));
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: batchInsertTasksMock,
      queue: { enqueue },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getOriginalContent: vi.fn().mockResolvedValue('登录优化'),
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });
    const vetoMessage: AgentMessage = {
      ...baseMessage,
      type: 'veto',
      payload: {
        issues: ['描述不足10字'],
        suggestions: ['请补充验收标准'],
        project_id: 'project-1'
      }
    };

    await expect(agent.handle(vetoMessage)).resolves.toEqual(
      expect.objectContaining({
        to: 'zhongshui',
        type: 'response',
        payload: expect.objectContaining({
          status: 'awaiting_manual_revision',
          issues: ['描述不足10字'],
          suggestions: ['请补充验收标准']
        })
      })
    );

    expect(ai.chat).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'menxia',
        payload: expect.not.objectContaining({
          original_content: expect.anything()
        })
      })
    );
  });

  it('ignores empty veto payloads without retrying AI', async () => {
    const { registry, ai } = createRegistry(
      JSON.stringify({
        type: 'task',
        tasks: [],
        review_notes: []
      })
    );
    const enqueue = vi.fn().mockResolvedValue('bull-job-1');
    const agent = new ZhongShuAgent({
      registry,
      batchInsertTasks: vi.fn().mockResolvedValue([]),
      queue: { enqueue },
      tableSync: { batchSyncTasksToTable: vi.fn().mockResolvedValue(undefined) },
      getOriginalContent: vi.fn().mockResolvedValue('登录优化'),
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    const vetoMessage: AgentMessage = {
      ...baseMessage,
      type: 'veto',
      payload: {
        issues: [],
        suggestions: [],
        project_id: 'project-1'
      }
    };

    await expect(agent.handle(vetoMessage)).resolves.toEqual(
      expect.objectContaining({
        to: 'zhongshui',
        type: 'response',
        payload: expect.objectContaining({
          status: 'ignored_empty_veto'
        })
      })
    );
    expect(ai.chat).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
