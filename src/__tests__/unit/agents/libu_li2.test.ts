import { describe, expect, it, vi } from 'vitest';
import { LibuLi2Agent } from '@/agents/libu_li2/LibuLi2Agent';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type { SelectChangeRequest, SelectProject, SelectTask, SelectUser } from '@/lib/schema';

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
      content: '**【上周完成】**\n- 完成A\n\n**【本周计划】**\n- 推进B\n\n**【需关注】**\n- 无',
      inputTokens: 10,
      outputTokens: 10
    }),
    stream: vi.fn()
  };
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
    insertWeeklyReport: vi.fn().mockResolvedValue(undefined),
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
  return { agent, im, ai };
}

describe('LibuLi2Agent', () => {
  it('sends weekly report markdown', async () => {
    const { agent, im } = createAgent();
    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_li2',
      type: 'request',
      payload: { project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(im.sendMarkdown).toHaveBeenCalledWith('https://example.com/hook', expect.stringContaining('上周完成'));
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

    expect(im.sendMarkdown).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.stringContaining('进行中 → 待验收')
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
