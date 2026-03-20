import { describe, expect, it, vi } from 'vitest';
import { createAgentTriggerHandler } from '@/app/api/agents/trigger/route';
import { createSetupAiTestHandler } from '@/app/api/setup/test-ai/route';
import { createSetupWecomTestHandler } from '@/app/api/setup/test-wecom/route';
import type { IMAdapter } from '@/adapters/types';
import type { SelectProject, SelectWorkspace } from '@/lib/schema';

const workspaceFixture: SelectWorkspace = {
  id: 'workspace-1',
  name: 'GW-PM',
  slug: 'gw-pm',
  plan: 'pro',
  adapterConfig: {
    ai: {
      defaultModel: 'doubao-fast'
    }
  },
  createdAt: new Date(),
  updatedAt: new Date()
};

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: '测试项目',
  type: 'custom',
  status: 'active',
  pmId: null,
  wecomGroupId: 'group-1',
  wecomBotWebhook: null,
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

describe('setup quick test routes', () => {
  it('uses workspace default AI model when test-ai request omits model', async () => {
    const ensureRegistryConfig = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(undefined);
    const POST = createSetupAiTestHandler({
      ensureRegistryConfig,
      ensureWorkspace: vi.fn().mockResolvedValue(workspaceFixture),
      chat,
      now: vi.fn().mockReturnValue(100).mockReturnValueOnce(0)
    });

    const response = await POST(new Request('http://localhost/api/setup/test-ai', { method: 'POST', body: '{}' }));
    const data = await response.json();

    expect(ensureRegistryConfig).toHaveBeenCalled();
    expect(chat).toHaveBeenCalledWith('doubao-fast');
    expect(data).toEqual(
      expect.objectContaining({
        success: true,
        model: 'doubao-fast'
      })
    );
  });

  it('returns a clear error when bot websocket is not connected', async () => {
    const sendMarkdown = vi.fn();
    const im: IMAdapter = {
      sendMessage: vi.fn(),
      sendMarkdown,
      sendCard: vi.fn(),
      sendDM: vi.fn(),
      parseIncoming: vi.fn(),
      getGroupMembers: vi.fn(),
      getConnectionStatus: () => ({ connected: false, mode: 'bot', detail: 'BOT WebSocket 当前未连接' })
    };
    const POST = createSetupWecomTestHandler({
      ensureRegistryConfig: vi.fn().mockResolvedValue(undefined),
      ensureWorkspace: vi.fn().mockResolvedValue(workspaceFixture),
      listProjects: vi.fn().mockResolvedValue([projectFixture]),
      getIM: () => im
    });

    const response = await POST(
      new Request('http://localhost/api/setup/test-wecom', {
        method: 'POST',
        body: JSON.stringify({ projectId: projectFixture.id })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(sendMarkdown).not.toHaveBeenCalled();
    expect(data).toEqual(
      expect.objectContaining({
        success: false,
        error: 'BOT WebSocket 当前未连接'
      })
    );
  });

  it('loads DB config before triggering weekly report and returns JSON error on failure', async () => {
    const ensureRegistryConfig = vi.fn().mockResolvedValue(undefined);
    const runWeeklyReport = vi.fn().mockRejectedValue(new Error('缺少 Doubao API Key'));
    const POST = createAgentTriggerHandler({
      ensureRegistryConfig,
      getProject: vi.fn().mockResolvedValue(projectFixture),
      runWeeklyReport
    });

    const response = await POST(
      new Request('http://localhost/api/agents/trigger', {
        method: 'POST',
        body: JSON.stringify({ type: 'weekly_report', projectId: projectFixture.id })
      })
    );
    const data = await response.json();

    expect(ensureRegistryConfig).toHaveBeenCalled();
    expect(runWeeklyReport).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(data).toEqual(
      expect.objectContaining({
        success: false,
        error: '缺少 Doubao API Key'
      })
    );
  });
});
