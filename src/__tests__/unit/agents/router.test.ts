import { describe, expect, it, vi } from 'vitest';
import { AgentRouter } from '@/agents/base/AgentRouter';
import { BaseAgent } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';

const message: AgentMessage = {
  id: 'msg-1',
  from: 'zhongshui',
  to: 'libu_bing',
  type: 'request',
  payload: {},
  context: {
    workspace_id: 'workspace-1',
    job_id: 'job-1',
    trace_ids: []
  },
  priority: 2,
  created_at: new Date('2026-03-17T00:00:00Z').toISOString()
};

class MockAgent extends BaseAgent {
  readonly agentType = 'libu_bing' as const;

  run = vi.fn().mockResolvedValue(message);

  constructor() {
    super({
      registry: {
        getIM: () =>
          ({
            sendMessage: vi.fn(),
            sendMarkdown: vi.fn(),
            sendCard: vi.fn(),
            sendDM: vi.fn(),
            parseIncoming: vi.fn(),
            getGroupMembers: vi.fn()
          }) as never,
        getAI: () =>
          ({
            chat: vi.fn(),
            stream: vi.fn()
          }) as never
      },
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn(),
      getProjectById: vi.fn()
    });
  }

  async handle(): Promise<AgentMessage> {
    return message;
  }
}

describe('AgentRouter', () => {
  it('register and getAgent work', () => {
    const router = new AgentRouter();
    const agent = new MockAgent();

    router.register(agent);

    expect(router.getAgent('libu_bing')).toBe(agent);
  });

  it('route delegates to the matching agent', async () => {
    const router = new AgentRouter();
    const agent = new MockAgent();
    router.register(agent);

    await router.route(message);

    expect(agent.run).toHaveBeenCalledWith(message);
  });

  it('route throws when agent type is unknown', async () => {
    const router = new AgentRouter();

    await expect(router.route({ ...message, to: 'capacity' })).rejects.toThrow('capacity');
  });
});
