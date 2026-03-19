import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWeComWebhookHandlers } from '@/app/api/webhooks/wecom/route';
import type { IncomingMessage } from '@/adapters/types';
import type { SelectProject } from '@/lib/schema';

const projectFixture: SelectProject = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: null,
  wecomGroupId: 'g1',
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

function createRequest(body: string) {
  return new Request('http://localhost/api/webhooks/wecom', {
    method: 'POST',
    body
  });
}

describe('wecom webhook', () => {
  it('enqueues parse_requirement when bot is mentioned', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const parseIncoming = vi.fn<() => Promise<IncomingMessage | null>>().mockResolvedValue({
      type: 'text',
      userId: 'u1',
      groupId: 'g1',
      text: '@助手 分析需求：做一个任务面板',
      rawPayload: {}
    });
    const parseIntent = vi.fn().mockReturnValue({
      intent: 'parse_requirement',
      params: { content: '做一个任务面板' }
    });
    const handlers = createWeComWebhookHandlers({
      parseIncoming,
      parseIntent,
      enqueue,
      getProjectByGroupId: vi.fn().mockResolvedValue(projectFixture),
      botName: '助手'
    });

    await handlers.POST(createRequest('<xml />'));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'zhongshui',
        payload: expect.objectContaining({
          intent: 'parse_requirement',
          project_id: 'p1'
        })
      })
    );
  });

  it('enqueues weekly_report when bot is mentioned', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const handlers = createWeComWebhookHandlers({
      parseIncoming: vi.fn().mockResolvedValue({
        type: 'text',
        userId: 'u1',
        groupId: 'g1',
        text: '@助手 周报',
        rawPayload: {}
      }),
      parseIntent: vi.fn().mockReturnValue({
        intent: 'weekly_report',
        params: {}
      }),
      enqueue,
      getProjectByGroupId: vi.fn().mockResolvedValue(projectFixture),
      botName: '助手'
    });

    await handlers.POST(createRequest('<xml />'));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'zhongshui',
        payload: expect.objectContaining({ intent: 'weekly_report' })
      })
    );
  });

  it('accepts configured full bot name mentions', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const handlers = createWeComWebhookHandlers({
      parseIncoming: vi.fn().mockResolvedValue({
        type: 'text',
        userId: 'u1',
        groupId: 'g1',
        text: '@研发项目管理助手 分析需求，登录流程优化',
        rawPayload: {}
      }),
      parseIntent: vi.fn().mockReturnValue({
        intent: 'parse_requirement',
        params: { content: '登录流程优化' }
      }),
      enqueue,
      getProjectByGroupId: vi.fn().mockResolvedValue(projectFixture),
      botName: '研发项目管理助手'
    });

    await handlers.POST(createRequest('<xml />'));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'zhongshui',
        payload: expect.objectContaining({
          intent: 'parse_requirement'
        })
      })
    );
  });

  it('routes change_confirmed button click to shangshu', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const handlers = createWeComWebhookHandlers({
      parseIncoming: vi.fn().mockResolvedValue({
        type: 'button_click',
        userId: 'u1',
        groupId: 'g1',
        buttonAction: 'change_confirmed:cr-123',
        rawPayload: {}
      }),
      enqueue,
      getProjectByGroupId: vi.fn().mockResolvedValue(projectFixture)
    });

    await handlers.POST(createRequest('<xml />'));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'shangshu',
        type: 'change_confirmed',
        payload: expect.objectContaining({ change_request_id: 'cr-123' })
      })
    );
  });

  it('returns 200 and does not enqueue when project is not configured', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const handlers = createWeComWebhookHandlers({
      parseIncoming: vi.fn().mockResolvedValue({
        type: 'text',
        userId: 'u1',
        groupId: 'unknown',
        text: '@助手 风险',
        rawPayload: {}
      }),
      enqueue,
      getProjectByGroupId: vi.fn().mockResolvedValue(null),
      botName: '助手'
    });

    const response = await handlers.POST(createRequest('<xml />'));

    expect(response.status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 200 and ignores normal messages without bot mention', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const handlers = createWeComWebhookHandlers({
      parseIncoming: vi.fn().mockResolvedValue({
        type: 'text',
        userId: 'u1',
        groupId: 'g1',
        text: '今天先看下任务',
        rawPayload: {}
      }),
      enqueue,
      getProjectByGroupId: vi.fn().mockResolvedValue(projectFixture),
      botName: '助手'
    });

    const response = await handlers.POST(createRequest('<xml />'));

    expect(response.status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('verifies GET signature and returns echostr', async () => {
    const token = 'test-token';
    const timestamp = '123';
    const nonce = '456';
    const signature = createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex');
    const handlers = createWeComWebhookHandlers({ token });
    const request = new Request(
      `http://localhost/api/webhooks/wecom?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}&echostr=ok`
    );

    const response = await handlers.GET(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('ok');
  });
});
