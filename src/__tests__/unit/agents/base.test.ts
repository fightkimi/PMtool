import { describe, expect, it, vi } from 'vitest';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
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
  to: 'libu_bing',
  type: 'request',
  payload: { hello: 'world' },
  context: {
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    job_id: 'incoming-job',
    trace_ids: []
  },
  priority: 2,
  created_at: new Date('2026-03-17T00:00:00Z').toISOString()
};

class TestAgent extends BaseAgent {
  readonly agentType = 'libu_bing' as const;

  constructor(
    private readonly resultFactory: () => Promise<AgentMessage>,
    deps: BaseAgentDeps
  ) {
    super(deps);
  }

  async handle(): Promise<AgentMessage> {
    return this.resultFactory();
  }

  async callNotifyGroup(projectId: string, text: string): Promise<void> {
    await this.notifyGroup(projectId, text);
  }

  async callGetProject(projectId: string): Promise<SelectProject> {
    return this.getProject(projectId);
  }
}

function createAdapters() {
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
    im,
    ai
  };
}

describe('BaseAgent', () => {
  it('run creates and updates agent job on success', async () => {
    const { registry } = createAdapters();
    const createJob = vi.fn().mockResolvedValue({ id: 'job-1' });
    const updateJob = vi.fn().mockResolvedValue(undefined);
    const result: AgentMessage = { ...baseMessage, id: 'msg-2', to: 'libu_bing', context: { ...baseMessage.context, job_id: 'job-1' } };
    const agent = new TestAgent(() => Promise.resolve(result), {
      registry,
      createAgentJob: createJob,
      updateAgentJob: updateJob,
      getProjectById: vi.fn().mockResolvedValue(projectFixture)
    });

    const response = await agent.run(baseMessage);

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'libu_bing',
        status: 'running'
      })
    );
    expect(updateJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: 'success',
        output: response
      })
    );
  });

  it('run marks failed job and rethrows', async () => {
    const { registry } = createAdapters();
    const createJob = vi.fn().mockResolvedValue({ id: 'job-2' });
    const updateJob = vi.fn().mockResolvedValue(undefined);
    const agent = new TestAgent(() => Promise.reject(new Error('boom')), {
      registry,
      createAgentJob: createJob,
      updateAgentJob: updateJob,
      getProjectById: vi.fn().mockResolvedValue(projectFixture)
    });

    await expect(agent.run(baseMessage)).rejects.toThrow('boom');
    expect(updateJob).toHaveBeenCalledWith(
      'job-2',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'boom'
      })
    );
  });

  it('notifyGroup uses IMAdapter.sendMarkdown', async () => {
    const { registry, im } = createAdapters();
    const agent = new TestAgent(() => Promise.resolve(baseMessage), {
      registry,
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.callNotifyGroup('project-1', 'hello group');

    expect(im.sendMarkdown).toHaveBeenCalledWith('https://example.com/hook', 'hello group');
  });

  it('getProject uses cache on second call', async () => {
    const { registry } = createAdapters();
    const getProjectByIdMock = vi.fn().mockResolvedValue(projectFixture);
    const agent = new TestAgent(() => Promise.resolve(baseMessage), {
      registry,
      getProjectById: getProjectByIdMock,
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn()
    });

    await agent.callGetProject('project-1');
    await agent.callGetProject('project-1');

    expect(getProjectByIdMock).toHaveBeenCalledTimes(1);
  });
});
