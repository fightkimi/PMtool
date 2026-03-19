import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, type IntentType } from '@/adapters/wecom/IntentParser';
import { WeComBotAdapter } from '@/adapters/wecom/WeComBotAdapter';
import { WeComWebhookAdapter, withRetry } from '@/adapters/wecom/WeComWebhookAdapter';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('WeComAdapter', () => {
  beforeEach(() => {
    WeComWebhookAdapter.clearTokenCache();
    WeComBotAdapter.clearTokenCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sendMarkdown uses appchat send API with chatid', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
    const adapter = new WeComWebhookAdapter({
      corpId: 'corp',
      agentId: '1000005',
      agentSecret: 'secret',
      fetcher
    });

    await adapter.sendMarkdown('chat-group-1', '**Hello**');

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=token-1',
      expect.any(Object)
    );
    const [, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      chatid: 'chat-group-1',
      msgtype: 'markdown',
      markdown: { content: '**Hello**' }
    });
  });

  it('sendCard uses textcard format for app messages', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
    const adapter = new WeComWebhookAdapter({
      corpId: 'corp',
      agentId: '1000005',
      agentSecret: 'secret',
      fetcher
    });

    await adapter.sendCard('chat-group-1', {
      title: '任务拆解完成',
      content: '请查看任务详情',
      buttons: [{ text: '查看', action: 'open_task' }]
    });

    const [, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init?.body))).toEqual({
      chatid: 'chat-group-1',
      msgtype: 'textcard',
      textcard: {
        title: '任务拆解完成',
        description: '请查看任务详情',
        url: 'https://work.weixin.qq.com',
        btntxt: '查看'
      }
    });
  });

  it('parseIncoming uses ChatId for group messages', async () => {
    const adapter = new WeComWebhookAdapter({});
    const xml = `
      <xml>
        <ToUserName><![CDATA[gh_12345]]></ToUserName>
        <ChatId><![CDATA[chat-group-1]]></ChatId>
        <FromUserName><![CDATA[user-1]]></FromUserName>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[项目进展怎么样]]></Content>
      </xml>
    `;

    const incoming = await adapter.parseIncoming(xml);

    expect(incoming).toEqual({
      type: 'text',
      userId: 'user-1',
      groupId: 'chat-group-1',
      text: '项目进展怎么样',
      buttonAction: undefined,
      rawPayload: xml
    });
  });

  it('IntentParser covers all supported intent types', () => {
    const cases: Array<[string, IntentType]> = [
      ['请帮我分析需求：项目=GW-PM', 'parse_requirement'],
      ['看看这个需求，优先级: 高', 'parse_requirement'],
      ['本周进度怎么样', 'weekly_report'],
      ['给我一份周报', 'weekly_report'],
      ['现在有什么风险', 'risk_scan'],
      ['这个项目卡住了吗', 'risk_scan'],
      ['这个活能接吗', 'capacity_evaluate'],
      ['帮我做工期评估', 'capacity_evaluate'],
      ['下月计划的产能还有多少人', 'capacity_forecast'],
      ['项目结束了，做个复盘', 'postmortem'],
      ['需求改了，需要调整排期', 'change_request'],
      ['这个需求要延期，帮我评估变更', 'change_request'],
      ['随便聊聊今天吃什么', 'unknown']
    ];

    for (const [text, expected] of cases) {
      expect(parse(text).intent).toBe(expected);
    }
  });

  it('withRetry retries once and then succeeds', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, 3, 0);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('withRetry returns undefined after exhausting retries', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('always fail'));

    const result = await withRetry(fn, 3, 0);

    expect(result).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('reuses cached access token within 30 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T00:00:00Z'));

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 7200 }))
      .mockResolvedValue(jsonResponse({ errcode: 0 }));

    const adapter = new WeComWebhookAdapter({
      corpId: 'corp',
      agentId: '1001',
      agentSecret: 'secret',
      fetcher
    });

    await adapter.sendDM('user-1', { type: 'text', text: 'hello' });
    vi.setSystemTime(new Date('2026-03-17T00:30:00Z'));
    await adapter.sendDM('user-1', { type: 'text', text: 'hello again' });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=corp&corpsecret=secret'
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

class MockWebSocket {
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  static readonly OPEN = 1;

  readyState = MockWebSocket.OPEN;

  send = vi.fn();

  ping = vi.fn();

  close = vi.fn(() => {
    this.emit('close');
  });

  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  listenerCount(event: string) {
    return (this.listeners.get(event) ?? []).length;
  }

  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

async function waitForListener(socket: MockWebSocket, event: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (socket.listenerCount(event) > 0) {
      return;
    }
    await Promise.resolve();
  }
}

describe('WeComBotAdapter', () => {
  beforeEach(() => {
    WeComBotAdapter.clearTokenCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start connects websocket and sends aibot_subscribe command', async () => {
    const socket = new MockWebSocket();
    const wsFactory = vi.fn().mockReturnValue(socket);

    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory
    });

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;

    expect(wsFactory).toHaveBeenCalledWith('wss://openws.work.weixin.qq.com');
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toEqual({
      cmd: 'aibot_subscribe',
      headers: { req_id: expect.any(String) },
      body: {
        bot_id: 'bot-id',
        secret: 'bot-secret'
      }
    });
  });

  it('parses websocket callback into IncomingMessage', async () => {
    const adapter = new WeComBotAdapter({});
    const incoming = await adapter.parseIncoming({
      cmd: 'aibot_msg_callback',
      body: {
        chatid: 'chat-1',
        chattype: 'group',
        from: { userid: 'user-1' },
        msgtype: 'text',
        text: { content: '你好' }
      }
    });

    expect(incoming).toEqual({
      type: 'text',
      userId: 'user-1',
      groupId: 'chat-1',
      text: '你好',
      buttonAction: undefined,
      rawPayload: {
        cmd: 'aibot_msg_callback',
        body: {
          chatid: 'chat-1',
          chattype: 'group',
          from: { userid: 'user-1' },
          msgtype: 'text',
          text: { content: '你好' }
        }
      }
    });
  });

  it('sendMessage sends aibot_respond_msg over websocket', async () => {
    const socket = new MockWebSocket();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory: vi.fn().mockReturnValue(socket)
    });

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;
    await adapter.sendMessage('chat-1', 'hello');

    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(socket.send.mock.calls[1]?.[0]))).toEqual({
      cmd: 'aibot_send_msg',
      headers: { req_id: expect.any(String) },
      body: {
        aibotid: 'bot-id',
        chatid: 'chat-1',
        msgtype: 'text',
        text: { content: 'hello' }
      }
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('sendCard sends markdown content over websocket in bot mode', async () => {
    const socket = new MockWebSocket();
    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory: vi.fn().mockReturnValue(socket)
    });

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;
    await adapter.sendCard('chat-1', {
      title: '⚠️ 计划审核未通过',
      content: '已退回中书省修正。',
      buttons: [{ text: '查看详情', action: 'noop' }]
    });

    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(socket.send.mock.calls[1]?.[0]))).toEqual({
      cmd: 'aibot_send_msg',
      headers: { req_id: expect.any(String) },
      body: {
        aibotid: 'bot-id',
        chatid: 'chat-1',
        msgtype: 'markdown',
        markdown: {
          content: '---\n\n# ⚠️ 计划审核未通过\n\n> 已退回中书省修正。\n\n**可执行操作**\n1. 查看详情'
        }
      }
    });
  });

  it('renders productized sections for review summary cards', async () => {
    const socket = new MockWebSocket();
    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory: vi.fn().mockReturnValue(socket)
    });

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;
    await adapter.sendCard('chat-1', {
      title: '⚠️ 计划审核未通过',
      content: [
        '审核结果：',
        '未通过',
        '风险等级：',
        '高风险',
        '问题：',
        '1. 需求边界不清',
        '2. 工期依据不足',
        '建议：',
        '1. 补充验收标准',
        '下一步：',
        '1. 修正后重新提交'
      ].join('\n\n')
    });

    const payload = JSON.parse(String(socket.send.mock.calls[1]?.[0]));
    expect(payload.body.markdown.content).toContain('**🧾 审核结果**');
    expect(payload.body.markdown.content).toContain('❌ 未通过');
    expect(payload.body.markdown.content).toContain('**🚨 风险等级**');
    expect(payload.body.markdown.content).toContain('🔴 高风险');
    expect(payload.body.markdown.content).toContain('**⚠️ 主要问题**');
    expect(payload.body.markdown.content).toContain('1. 需求边界不清');
    expect(payload.body.markdown.content).toContain('**👉 下一步怎么补充**');
  });

  it('logs an error instead of throwing when websocket is disconnected', async () => {
    const socket = new MockWebSocket();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory: vi.fn().mockReturnValue(socket)
    });

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;
    socket.readyState = 0;

    await expect(adapter.sendMessage('chat-1', 'hello')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('[WeComBot] WebSocket 未连接，无法发送消息');
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated websocket messages by msgid', async () => {
    const socket = new MockWebSocket();
    const listener = vi.fn();
    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory: vi.fn().mockReturnValue(socket)
    });
    adapter.onMessage(listener);

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;

    const payload = JSON.stringify({
      cmd: 'aibot_msg_callback',
      body: {
        msgid: 'msg-1',
        chatid: 'chat-1',
        chattype: 'group',
        from: { userid: 'user-1' },
        msgtype: 'text',
        text: { content: '你好' }
      }
    });

    socket.emit('message', payload);
    await Promise.resolve();
    socket.emit('message', payload);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sends heartbeat ping after 30 seconds', async () => {
    const socket = new MockWebSocket();
    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory: vi.fn().mockReturnValue(socket)
    });

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;

    vi.advanceTimersByTime(30_000);

    expect(socket.ping).toHaveBeenCalledTimes(1);
  });

  it('reconnects automatically after websocket closes', async () => {
    const firstSocket = new MockWebSocket();
    const secondSocket = new MockWebSocket();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const wsFactory = vi
      .fn()
      .mockReturnValueOnce(firstSocket)
      .mockReturnValueOnce(secondSocket);

    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory
    });

    const startPromise = adapter.start();
    await waitForListener(firstSocket, 'open');
    firstSocket.emit('open');
    await startPromise;

    firstSocket.emit('close', 1000, Buffer.from('network'));
    vi.advanceTimersByTime(5000);
    await waitForListener(secondSocket, 'open');
    secondSocket.emit('open');
    vi.advanceTimersByTime(30_000);

    expect(wsFactory).toHaveBeenCalledTimes(2);
    expect(wsFactory).toHaveBeenNthCalledWith(1, 'wss://openws.work.weixin.qq.com');
    expect(wsFactory).toHaveBeenNthCalledWith(2, 'wss://openws.work.weixin.qq.com');
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(firstSocket.ping).toHaveBeenCalledTimes(0);
    expect(secondSocket.ping).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
  });

  it('reconnects after disconnected_event callback', async () => {
    const firstSocket = new MockWebSocket();
    const secondSocket = new MockWebSocket();
    const wsFactory = vi
      .fn()
      .mockReturnValueOnce(firstSocket)
      .mockReturnValueOnce(secondSocket);

    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory
    });

    const startPromise = adapter.start();
    await waitForListener(firstSocket, 'open');
    firstSocket.emit('open');
    await startPromise;

    await adapter.parseIncoming({
      cmd: 'aibot_event_callback',
      body: {
        event: {
          eventtype: 'disconnected_event'
        }
      }
    });
    firstSocket.emit(
      'message',
      JSON.stringify({
        cmd: 'aibot_event_callback',
        body: {
          event: {
            eventtype: 'disconnected_event'
          }
        }
      })
    );

    vi.advanceTimersByTime(5000);
    await waitForListener(secondSocket, 'open');
    secondSocket.emit('open');

    expect(wsFactory).toHaveBeenCalledTimes(2);
  });

  it('ignores aibot_event_callback without throwing', async () => {
    const adapter = new WeComBotAdapter({});

    await expect(
      adapter.parseIncoming({
        cmd: 'aibot_event_callback',
        body: {
          event: {
            eventtype: 'custom'
          }
        }
      })
    ).resolves.toBeNull();
  });

  it('logs send failure without throwing when websocket send throws', async () => {
    const socket = new MockWebSocket();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    socket.send.mockImplementation((data: string) => {
      const payload = JSON.parse(data);
      if (payload.cmd === 'aibot_send_msg') {
        throw new Error('boom');
      }
    });

    const adapter = new WeComBotAdapter({
      botId: 'bot-id',
      botSecret: 'bot-secret',
      wsFactory: vi.fn().mockReturnValue(socket)
    });

    const startPromise = adapter.start();
    await waitForListener(socket, 'open');
    socket.emit('open');
    await startPromise;

    await expect(adapter.sendMessage('chat-1', 'hello')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[WeComBot] 发消息失败，已忽略:', 'boom');
    errorSpy.mockRestore();
  });
});
