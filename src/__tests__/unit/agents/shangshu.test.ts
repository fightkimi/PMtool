import { describe, expect, it, vi } from 'vitest';
import { ShangShuAgent } from '@/agents/shangshu/ShangShuAgent';
import type { AgentMessage } from '@/agents/base/types';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type {
  InsertPipelineStageInstance,
  SelectChangeRequest,
  SelectPipelineStageInstance,
  SelectProject,
  SelectTask,
  SelectUser
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

const requestMessage: AgentMessage = {
  id: 'msg-1',
  from: 'menxia',
  to: 'shangshu',
  type: 'request',
  payload: {
    mode: 'task',
    ids: ['t1', 't2', 't3'],
    project_id: 'project-1'
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

function createTask(id: string, title: string, department: SelectTask['department']): SelectTask {
  return {
    id,
    projectId: 'project-1',
    parentId: null,
    title,
    description: 'desc',
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    reviewerId: null,
    department,
    estimatedHours: 8,
    actualHours: null,
    earliestStart: null,
    latestFinish: null,
    floatDays: null,
    githubIssueNumber: null,
    acceptanceCriteria: ['标准1', '标准2'],
    tableRecordId: null,
    dueAt: new Date('2026-04-10T00:00:00Z'),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function createUser(id: string, imUserId: string, skill: string, loadScore: number): SelectUser & { loadScore: number } {
  return {
    id,
    workspaceId: 'workspace-1',
    name: id,
    email: `${id}@example.com`,
    role: 'dev',
    imUserId,
    workHoursPerWeek: '40',
    skills: [skill],
    createdAt: new Date(),
    updatedAt: new Date(),
    loadScore
  };
}

function createAgent(options: {
  tasks?: SelectTask[];
  changeRequest?: SelectChangeRequest;
  stagesByRun?: SelectPipelineStageInstance[];
  usersBySkill?: Record<string, Array<SelectUser & { loadScore: number }>>;
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
  const updateTask = vi.fn().mockResolvedValue(undefined);
  const batchUpdateStagesMock = vi.fn().mockResolvedValue(undefined);
  const updateChangeRequest = vi.fn().mockResolvedValue(undefined);
  const getUserById = vi.fn().mockImplementation(async (id: string) => {
    for (const group of Object.values(options.usersBySkill ?? {})) {
      const match = group.find((user) => user.id === id);
      if (match) {
        return match;
      }
    }
    return null;
  });

  const agent = new ShangShuAgent({
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    getProjectById: vi.fn().mockResolvedValue(projectFixture),
    createAgentJob: vi.fn(),
    updateAgentJob: vi.fn(),
    getTasksByIds: vi.fn().mockResolvedValue(options.tasks ?? []),
    getCandidatesForDepartment: vi.fn().mockImplementation(async (_workspaceId: string, skill: string) => {
      return options.usersBySkill?.[skill] ?? [];
    }),
    updateTask,
    batchUpdateStages: batchUpdateStagesMock,
    getChangeRequestById: vi.fn().mockResolvedValue(options.changeRequest ?? null),
    getStagesByRunIds: vi.fn().mockResolvedValue(options.stagesByRun ?? []),
    getTasksByAffectedIds: vi.fn().mockResolvedValue([]),
    updateChangeRequest,
    syncPipelineTable: vi.fn().mockResolvedValue(undefined),
    syncTasksTable: vi.fn().mockResolvedValue(undefined),
    getUserById
  });

  return { agent, im, updateTask, batchUpdateStagesMock, updateChangeRequest };
}

describe('ShangShuAgent', () => {
  it('assigns tasks and sends DM to each assignee', async () => {
    const tasks = [
      createTask('t1', '任务1', 'libu_li'),
      createTask('t2', '任务2', 'libu_hu'),
      createTask('t3', '任务3', 'libu_gong')
    ];
    const { agent, im, updateTask } = createAgent({
      tasks,
      usersBySkill: {
        libu_li: [createUser('u1', 'im-1', 'libu_li', 1)],
        libu_hu: [createUser('u2', 'im-2', 'libu_hu', 1)],
        libu_gong: [createUser('u3', 'im-3', 'libu_gong', 1)]
      }
    });

    await agent.handle(requestMessage);

    expect(updateTask).toHaveBeenCalledTimes(3);
    expect(im.sendDM).toHaveBeenCalledTimes(3);
    expect(new Set(vi.mocked(im.sendDM).mock.calls.map((call) => call[0]))).toEqual(
      new Set(['im-1', 'im-2', 'im-3'])
    );
  });

  it('shifts stage schedule when change is confirmed', async () => {
    const changeRequest = {
      id: 'cr-1',
      projectId: 'project-1',
      source: 'requirement',
      title: '需求变更',
      description: '描述',
      requestedBy: null,
      status: 'evaluating',
      affectedTaskIds: [],
      affectedRunIds: ['run-1'],
      scheduleImpactDays: 3,
      evaluationByAgent: null,
      cascadeExecutedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } satisfies SelectChangeRequest;
    const stages = [
      {
        id: 's1',
        runId: 'run-1',
        stageKey: 'A',
        roleType: 'qa',
        assigneeId: 'u1',
        plannedStart: new Date('2026-04-05T00:00:00Z'),
        plannedEnd: new Date('2026-04-10T00:00:00Z'),
        actualStart: null,
        actualEnd: null,
        estimatedHours: 10,
        dependsOn: [],
        floatDays: null,
        status: 'pending',
        tableRecordId: null,
        taskId: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 's2',
        runId: 'run-1',
        stageKey: 'B',
        roleType: 'qa',
        assigneeId: 'u2',
        plannedStart: new Date('2026-04-10T00:00:00Z'),
        plannedEnd: new Date('2026-04-15T00:00:00Z'),
        actualStart: null,
        actualEnd: null,
        estimatedHours: 8,
        dependsOn: ['A'],
        floatDays: null,
        status: 'pending',
        tableRecordId: null,
        taskId: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ] satisfies SelectPipelineStageInstance[];
    const { agent, batchUpdateStagesMock, im } = createAgent({
      changeRequest,
      stagesByRun: stages,
      usersBySkill: {
        qa: [
          createUser('u1', 'im-1', 'qa', 1),
          createUser('u2', 'im-2', 'qa', 2)
        ]
      }
    });

    await agent.handle({
      ...requestMessage,
      payload: { change_request_id: 'cr-1' }
    });

    const updates = batchUpdateStagesMock.mock.calls[0]?.[0] as Array<{
      id: string;
      data: Partial<InsertPipelineStageInstance>;
    }>;
    expect(updates[0]?.data.plannedEnd).toEqual(new Date('2026-04-13T00:00:00.000Z'));
    expect(updates[1]?.data.plannedEnd).toEqual(new Date('2026-04-18T00:00:00.000Z'));
    expect(im.sendDM).toHaveBeenCalledTimes(2);
  });
});
