import { describe, expect, it, vi } from 'vitest';
import { LibuLi2Agent } from '@/agents/libu_li2/LibuLi2Agent';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type { SelectChangeRequest, SelectPipelineStageInstance, SelectProject, SelectRisk, SelectTask, SelectUser } from '@/lib/schema';

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

function createAgent() {
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
      content: '**【上周完成】**\n- 完成A\n\n**【下周关键推进】**\n- 推进B\n\n**【PM需关注】**\n- 关注里程碑偏差',
      inputTokens: 10,
      outputTokens: 10
    }),
    stream: vi.fn()
  };
  const insertWeeklyReport = vi.fn().mockResolvedValue(undefined);
  const agent = new LibuLi2Agent({
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    getProjectById: vi.fn().mockResolvedValue(projectFixture),
    createAgentJob: vi.fn(),
    updateAgentJob: vi.fn(),
    getCompletedTasks: vi.fn().mockResolvedValue([]),
    getCompletedStages: vi.fn().mockResolvedValue([]),
    getUpcomingTasks: vi.fn().mockResolvedValue([]),
    getUpcomingStages: vi.fn().mockResolvedValue([]),
    getNewRisks: vi.fn().mockResolvedValue([]),
    getOpenRisks: vi.fn().mockResolvedValue([]),
    getRecentChanges: vi.fn().mockResolvedValue([]),
    getCriticalStages: vi.fn().mockResolvedValue([]),
    insertWeeklyReport,
    getTaskById: vi.fn().mockResolvedValue({
      id: 'task-1',
      projectId: 'project-1',
      parentId: null,
      title: '任务一',
      description: 'desc',
      status: 'review',
      priority: 'medium',
      assigneeId: 'u1',
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
    } satisfies SelectTask),
    getUserById: vi.fn().mockResolvedValue({ id: 'u1', name: '张三', imUserId: 'im-u1' } as SelectUser),
    getChangeRequestById: vi.fn().mockResolvedValue({
      id: 'cr-1',
      projectId: 'project-1',
      source: 'requirement',
      title: '需求变更',
      description: null,
      requestedBy: null,
      status: 'evaluating',
      affectedTaskIds: [],
      affectedRunIds: [],
      scheduleImpactDays: 2,
      evaluationByAgent: null,
      cascadeExecutedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } satisfies SelectChangeRequest),
    getUsersByIds: vi.fn().mockResolvedValue([
      { id: 'u1', name: '张三', imUserId: 'im-u1' },
      { id: 'u2', name: '李四', imUserId: 'im-u2' }
    ] as SelectUser[])
  });
  return { agent, im, ai, insertWeeklyReport };
}

describe('LibuLi2Agent', () => {
  it('sends a PM-oriented weekly report card', async () => {
    const { im, ai, insertWeeklyReport } = createAgent();
    vi.mocked(ai.chat).mockResolvedValueOnce({
      content: '**【上周完成】**\n- 完成登录优化提测\n\n**【下周关键推进】**\n- 推进验收与上线准备\n\n**【PM需关注】**\n- 关注封版节点',
      inputTokens: 10,
      outputTokens: 10
    });
    const getCompletedTasks = vi.fn().mockResolvedValue([
      { title: '登录优化提测' }
    ] as SelectTask[]);
    const getCompletedStages = vi.fn().mockResolvedValue([
      { stageKey: 'dev', actualEnd: new Date('2026-03-16T00:00:00.000Z') }
    ] as SelectPipelineStageInstance[]);
    const getUpcomingTasks = vi.fn().mockResolvedValue([
      { title: '验收测试', dueAt: new Date('2026-03-25T00:00:00.000Z') }
    ] as SelectTask[]);
    const getNewRisks = vi.fn().mockResolvedValue([
      { description: '接口联调延迟', level: 'high' }
    ] as SelectRisk[]);
    const getOpenRisks = vi.fn().mockResolvedValue([
      { description: '接口联调延迟', level: 'high', status: 'open' },
      { description: '里程碑风险：封版', level: 'critical', status: 'open' }
    ] as SelectRisk[]);
    const getRecentChanges = vi.fn().mockResolvedValue([
      { title: '登录异常提示调整', status: 'evaluating', scheduleImpactDays: 2 }
    ] as SelectChangeRequest[]);
    const getCriticalStages = vi.fn().mockResolvedValue([
      { stageKey: 'qa', plannedEnd: new Date('2026-03-26T00:00:00.000Z'), status: 'blocked', floatDays: 0 }
    ] as SelectPipelineStageInstance[]);

    const richerAgent = new LibuLi2Agent({
      registry: {
        getIM: () => im,
        getAI: () => ai
      },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn(),
      now: () => new Date('2026-03-20T08:00:00.000Z'),
      getCompletedTasks,
      getCompletedStages,
      getUpcomingTasks,
      getUpcomingStages: vi.fn().mockResolvedValue([]),
      getNewRisks,
      getOpenRisks,
      getRecentChanges,
      getCriticalStages,
      insertWeeklyReport,
      getTaskById: vi.fn(),
      getUserById: vi.fn(),
      getChangeRequestById: vi.fn(),
      getUsersByIds: vi.fn()
    });

    await richerAgent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_li2',
      type: 'request',
      payload: { project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(im.sendCard).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        title: 'GW-PM 周报',
        content: expect.stringContaining('【周度摘要】')
      })
    );
    const card = vi.mocked(im.sendCard).mock.calls[0]?.[1];
    expect(card?.content).toContain('开放风险 2 项，活跃变更 1 项');
    expect(card?.content).toContain('【关键路径 / 里程碑】');
    expect(card?.content).toContain('qa · 03/26 · blocked');
    expect(card?.content).toContain('封版');
    expect(card?.content).toContain('【下周 PM 动作】');
    expect(insertWeeklyReport).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        content: expect.stringContaining('【AI归纳】')
      })
    );
  });

  it('formats progress update labels', async () => {
    const { agent, im, ai } = createAgent();
    await agent.handle({
      id: 'msg-1',
      from: 'libu_gong',
      to: 'libu_li2',
      type: 'request',
      payload: { project_id: 'project-1', task_id: 'task-1', old_status: 'in_progress', new_status: 'review' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(im.sendCard).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        title: '任务一 进展同步',
        content: expect.stringContaining('进行中 → 待验收')
      })
    );
    expect(ai.chat).not.toHaveBeenCalled();
  });

  it('notifies all affected users about change', async () => {
    const { agent, im, ai } = createAgent();
    await agent.handle({
      id: 'msg-1',
      from: 'shangshu',
      to: 'libu_li2',
      type: 'request',
      payload: { change_request_id: 'cr-1', affected_user_ids: ['u1', 'u2'] },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(im.sendDM).toHaveBeenCalledTimes(2);
    expect(new Set(vi.mocked(im.sendDM).mock.calls.map((call) => call[0]))).toEqual(new Set(['im-u1', 'im-u2']));
    expect(ai.chat).not.toHaveBeenCalled();
  });
});
