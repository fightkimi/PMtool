import { describe, expect, it, vi } from 'vitest';
import { LibuLiAgent } from '@/agents/libu_li/LibuLiAgent';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type { SelectCapacitySnapshot, SelectProject, SelectUser } from '@/lib/schema';

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: 'pm-1',
  wecomGroupId: null,
  wecomBotWebhook: null,
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

const users: SelectUser[] = [
  {
    id: 'u1',
    workspaceId: 'workspace-1',
    name: 'A',
    email: 'a@example.com',
    role: 'designer',
    imUserId: 'im-a',
    workHoursPerWeek: '40',
    skills: ['ui_designer'],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'u2',
    workspaceId: 'workspace-1',
    name: 'B',
    email: 'b@example.com',
    role: 'designer',
    imUserId: 'im-b',
    workHoursPerWeek: '40',
    skills: ['ui_designer'],
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

function createRegistry() {
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

  return {
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    im
  };
}

describe('LibuLiAgent', () => {
  it('recommends the lowest-load assignee', async () => {
    const agent = new LibuLiAgent({
      getUsersBySkill: vi.fn().mockResolvedValue(users),
      countUserLoad: vi.fn().mockImplementation(async (userId: string) => (userId === 'u1' ? 3 : 1))
    });

    const result = await agent.recommendAssignee({ role_type: 'ui_designer' }, 'workspace-1');

    expect(result?.user.id).toBe('u2');
    expect(result?.reason).toContain('load_score=1');
  });

  it('returns capacity forecast and evaluates project gaps', async () => {
    const snapshots: SelectCapacitySnapshot[] = [
      {
        id: 's1',
        workspaceId: 'workspace-1',
        snapshotDate: '2026-03-17',
        weekStart: '2026-03-24',
        roleType: 'ui_designer',
        userId: 'u1',
        totalHours: '40',
        allocatedHours: '20',
        availableHours: '20',
        projectBreakdown: {},
        overloadFlag: false,
        createdAt: new Date()
      }
    ];
    const agent = new LibuLiAgent({
      getCapacitySnapshots: vi.fn().mockResolvedValue(snapshots),
      now: () => new Date('2026-03-17T00:00:00.000Z')
    });

    const forecast = await agent.getCapacityForecast('workspace-1', 4, 'ui_designer');
    const evaluation = await agent.evaluateNewProject({
      workspaceId: 'workspace-1',
      role_requirements: [{ role_type: 'ui_designer', hours_needed: 30 }],
      deadline: new Date('2026-04-30T00:00:00.000Z')
    });

    expect(forecast).toEqual([
      {
        week_start: '2026-03-24',
        role_type: 'ui_designer',
        available_hours: 20,
        allocated_hours: 20
      }
    ]);
    expect(evaluation.feasible).toBe(false);
    expect(evaluation.gaps[0]).toEqual({ role_type: 'ui_designer', shortfall_hours: 10 });
  });

  it('handles forecast and evaluate_project messages', async () => {
    const { registry, im } = createRegistry();
    const agent = new LibuLiAgent({
      registry,
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      getPMIMUserId: vi.fn().mockResolvedValue('pm-im'),
      getCapacitySnapshots: vi.fn().mockResolvedValue([]),
      now: () => new Date('2026-03-17T00:00:00.000Z')
    });

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_li',
      type: 'request',
      payload: {
        workspace_id: 'workspace-1',
        weeks: 4
      },
      context: {
        workspace_id: 'workspace-1',
        project_id: 'project-1',
        job_id: 'job-1',
        trace_ids: []
      },
      priority: 2,
      created_at: new Date().toISOString()
    });

    await agent.handle({
      id: 'msg-2',
      from: 'zhongshui',
      to: 'libu_li',
      type: 'request',
      payload: {
        workspace_id: 'workspace-1',
        project_id: 'project-1',
        deadline: '2026-04-30T00:00:00.000Z',
        role_requirements: [{ role_type: 'ui_designer', hours_needed: 10 }]
      },
      context: {
        workspace_id: 'workspace-1',
        project_id: 'project-1',
        job_id: 'job-2',
        trace_ids: []
      },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(im.sendDM).toHaveBeenCalledTimes(2);
  });
});
