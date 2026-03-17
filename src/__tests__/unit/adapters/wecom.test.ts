import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, type IntentType } from '@/adapters/wecom/IntentParser';
import { WeComAdapter, withRetry } from '@/adapters/wecom/WeComAdapter';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('WeComAdapter', () => {
  beforeEach(() => {
    WeComAdapter.clearTokenCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sendMarkdown builds the expected webhook body', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ errcode: 0 }));
    const adapter = new WeComAdapter({ fetcher });

    await adapter.sendMarkdown('https://example.com/webhook', '**Hello**');

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      msgtype: 'markdown',
      markdown: { content: '**Hello**' }
    });
  });

  it('parseIncoming parses plain XML payload correctly', async () => {
    const adapter = new WeComAdapter({});
    const xml = `
      <xml>
        <ToUserName><![CDATA[group-1]]></ToUserName>
        <FromUserName><![CDATA[user-1]]></FromUserName>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[项目进展怎么样]]></Content>
      </xml>
    `;

    const incoming = await adapter.parseIncoming(xml);

    expect(incoming).toEqual({
      type: 'text',
      userId: 'user-1',
      groupId: 'group-1',
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

    const adapter = new WeComAdapter({
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
