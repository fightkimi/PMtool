import { describe, expect, it, vi } from 'vitest';
import { ZhongshuiAgent } from '@/agents/zhongshui/ZhongshuiAgent';
import type { AgentMessage } from '@/agents/base/types';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type { SelectProject } from '@/lib/schema';

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
  dueAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function createMessage(intent: string, params: Record<string, string> = {}): AgentMessage {
  return {
    id: 'msg-1',
    from: 'zhongshui',
    to: 'zhongshui',
    type: 'request',
    payload: {
      intent,
      params,
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
}

function createAgent() {
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
    chat: vi.fn().mockResolvedValue({ content: 'risk_scan', inputTokens: 10, outputTokens: 5 }),
    stream: vi.fn()
  };

    const agent = new ZhongshuiAgent({
      queue: { enqueue },
    registry: {
      getIM: () => im,
      getAI: () => ai
    },
    getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn(),
      getPMIMUserId: vi.fn().mockResolvedValue('pm-im-1')
    });

  return { agent, enqueue, im, ai };
}

describe('ZhongshuiAgent', () => {
  it('routes parse_requirement to zhongshu', async () => {
    const { agent, enqueue } = createAgent();
    await agent.handle(createMessage('parse_requirement', { content: '需求内容' }));

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'zhongshu' }));
  });

  it('routes weekly_report to libu_li2', async () => {
    const { agent, enqueue } = createAgent();
    await agent.handle(createMessage('weekly_report'));

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'libu_li2' }));
  });

  it('routes risk_scan to libu_bing', async () => {
    const { agent, enqueue } = createAgent();
    await agent.handle(createMessage('risk_scan'));

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'libu_bing' }));
  });

  it('routes change_request to menxia with expected payload', async () => {
    const { agent, enqueue } = createAgent();
    await agent.handle(createMessage('change_request', { text: '需求改了' }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'menxia',
        payload: expect.objectContaining({
          type: 'change_request'
        })
      })
    );
  });

  it('uses AI to resolve unknown intent before enqueue', async () => {
    const { agent, enqueue, ai } = createAgent();
    await agent.handle(createMessage('unknown', { text: '帮我看看有没有风险' }));

    expect(ai.chat).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'libu_bing' }));
  });

  it('escalates milestone messages without enqueueing', async () => {
    const { agent, enqueue, im } = createAgent();
    await agent.handle(createMessage('change_request', { text: '这个里程碑可能要延期' }));

    expect(im.sendDM).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
