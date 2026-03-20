import { describe, expect, it, vi } from 'vitest';
import { CapacityAgent } from '@/agents/capacity/CapacityAgent';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type { SelectCapacitySnapshot, SelectPipelineStageInstance, SelectProject, SelectUser } from '@/lib/schema';

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

function createStage(id: string, assigneeId: string, estimatedHours: number): SelectPipelineStageInstance {
  return {
    id,
    runId: 'run-1',
    stageKey: id,
    roleType: assigneeId === 'u1' ? 'ui_designer' : 'qa',
    assigneeId,
    plannedStart: new Date('2026-03-24T00:00:00Z'),
    plannedEnd: new Date('2026-03-29T00:00:00Z'),
    actualStart: null,
    actualEnd: null,
    estimatedHours,
    dependsOn: [],
    floatDays: 0,
    status: 'active',
    tableRecordId: null,
    taskId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function createProject(id: string, name: string): SelectProject {
  return {
    ...projectFixture,
    id,
    name
  };
}

function createAgent(
  overloadedSnapshots: SelectCapacitySnapshot[] = [],
  options: {
    activeProjects?: SelectProject[];
    stagesByProject?: Record<string, SelectPipelineStageInstance[]>;
  } = {}
) {
  const im: IMAdapter = {
    sendMessage: vi.fn(),
    sendMarkdown: vi.fn(),
    sendCard: vi.fn(),
    sendDM: vi.fn(),
    parseIncoming: vi.fn(),
    getGroupMembers: vi.fn()
  };
  const ai: AIAdapter = { chat: vi.fn(), stream: vi.fn() };
  const upsertSnapshot = vi.fn().mockResolvedValue(undefined);
  const syncCapacityTable = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockResolvedValue('bull-job-1');
  const activeProjects = options.activeProjects ?? [projectFixture];
  const stagesByProject = options.stagesByProject ?? {
    [projectFixture.id]: [createStage('s1', 'u1', 48), createStage('s2', 'u2', 20)]
  };
  const users: SelectUser[] = [
    {
      id: 'u1',
      workspaceId: 'workspace-1',
      name: '设计',
      email: 'u1@example.com',
      role: 'designer',
      imUserId: 'im-u1',
      workHoursPerWeek: '40',
      skills: ['ui_designer'],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'u2',
      workspaceId: 'workspace-1',
      name: '测试',
      email: 'u2@example.com',
      role: 'qa',
      imUserId: 'im-u2',
      workHoursPerWeek: '40',
      skills: ['qa'],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];
  const agent = new CapacityAgent({
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    getProjectById: vi.fn().mockResolvedValue(projectFixture),
    createAgentJob: vi.fn(),
    updateAgentJob: vi.fn(),
    queue: { enqueue },
    now: () => new Date('2026-03-17T00:00:00Z'),
    getActiveProjects: vi.fn().mockResolvedValue(activeProjects),
    getTasksByProject: vi.fn().mockResolvedValue([]),
    getStagesByProject: vi.fn().mockImplementation(async (projectId: string) => stagesByProject[projectId] ?? []),
    getUsersByIds: vi.fn().mockResolvedValue(users),
    upsertSnapshot,
    syncCapacityTable,
    getOverloadedSnapshots: vi.fn().mockResolvedValue(overloadedSnapshots)
  });
  return { agent, upsertSnapshot, syncCapacityTable, enqueue };
}

describe('CapacityAgent', () => {
  it('creates daily snapshots and sets overload flag', async () => {
    const { agent, upsertSnapshot, syncCapacityTable } = createAgent();

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'capacity',
      type: 'request',
      payload: { workspace_id: 'workspace-1' },
      context: { workspace_id: 'workspace-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(upsertSnapshot).toHaveBeenCalledTimes(2);
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', overloadFlag: true }));
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', overloadFlag: false }));
    expect(syncCapacityTable).toHaveBeenCalledWith(
      'project-1',
      expect.arrayContaining([
        expect.objectContaining({ userId: 'u1', roleType: 'ui_designer' }),
        expect.objectContaining({ userId: 'u2', roleType: 'qa' })
      ])
    );
  });

  it('alerts when user is overloaded for two consecutive weeks', async () => {
    const { agent, enqueue } = createAgent([
      {
        id: 'c1',
        workspaceId: 'workspace-1',
        snapshotDate: '2026-03-17',
        weekStart: '2026-03-24',
        roleType: 'ui_designer',
        userId: 'u1',
        totalHours: '40',
        allocatedHours: '50',
        availableHours: '-10',
        projectBreakdown: { 'project-1': 50 },
        overloadFlag: true,
        createdAt: new Date()
      },
      {
        id: 'c2',
        workspaceId: 'workspace-1',
        snapshotDate: '2026-03-17',
        weekStart: '2026-03-31',
        roleType: 'ui_designer',
        userId: 'u1',
        totalHours: '40',
        allocatedHours: '52',
        availableHours: '-12',
        projectBreakdown: { 'project-1': 52 },
        overloadFlag: true,
        createdAt: new Date()
      }
    ]);

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'capacity',
      type: 'request',
      payload: { workspace_id: 'workspace-1' },
      context: { workspace_id: 'workspace-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'libu_bing' }));
  });

  it('aggregates the same user workload across multiple projects instead of overwriting it', async () => {
    const projectA = createProject('project-a', '项目A');
    const projectB = createProject('project-b', '项目B');
    const { agent, upsertSnapshot, syncCapacityTable } = createAgent([], {
      activeProjects: [projectA, projectB],
      stagesByProject: {
        [projectA.id]: [createStage('a-1', 'u1', 24)],
        [projectB.id]: [createStage('b-1', 'u1', 20)]
      }
    });

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'capacity',
      type: 'request',
      payload: { workspace_id: 'workspace-1' },
      context: { workspace_id: 'workspace-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(upsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        allocatedHours: '44',
        availableHours: '-4',
        overloadFlag: false,
        projectBreakdown: {
          'project-a': 24,
          'project-b': 20
        }
      })
    );
    expect(syncCapacityTable).toHaveBeenCalledWith(
      'project-a',
      expect.arrayContaining([expect.objectContaining({ userId: 'u1', allocatedHours: '24' })])
    );
    expect(syncCapacityTable).toHaveBeenCalledWith(
      'project-b',
      expect.arrayContaining([expect.objectContaining({ userId: 'u1', allocatedHours: '20' })])
    );
  });
});
