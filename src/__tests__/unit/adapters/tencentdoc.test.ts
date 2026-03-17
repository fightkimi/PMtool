import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('TencentDocAdapter', () => {
  beforeEach(() => {
    TencentDocAdapter.clearTokenCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('readTable maps API rows into DocRecord objects', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            columns: [
              { id: 'c1', name: '任务名' },
              { id: 'c2', name: '状态' }
            ],
            rows: [{ row_no: 1, cells: { c1: '创建 schema', c2: 'todo' } }]
          }
        })
      );

    const adapter = new TencentDocAdapter({ appId: 'app', appSecret: 'secret', fetcher });
    const records = await adapter.readTable('table-1');

    expect(records).toEqual([{ 任务名: '创建 schema', 状态: 'todo' }]);
  });

  it('createRecord sends the correct body and returns row id string', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ data: { row_no: 8 } }));

    const adapter = new TencentDocAdapter({ appId: 'app', appSecret: 'secret', fetcher });
    const recordId = await adapter.createRecord('table-1', { 状态: 'todo', 工时: 5 });

    const [, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init?.body))).toEqual({
      fields: { 状态: 'todo', 工时: 5 }
    });
    expect(recordId).toBe('8');
  });

  it('batchUpdate merges three updates into one HTTP request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const adapter = new TencentDocAdapter({ appId: 'app', appSecret: 'secret', fetcher });
    await adapter.batchUpdate('table-1', [
      { id: '1', fields: { 状态: 'todo' } },
      { id: '2', fields: { 状态: 'done' } },
      { id: '3', fields: { 状态: 'blocked' } }
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init?.body))).toEqual({
      updates: [
        { id: '1', fields: { 状态: 'todo' } },
        { id: '2', fields: { 状态: 'done' } },
        { id: '3', fields: { 状态: 'blocked' } }
      ]
    });
  });

  it('refreshes access token when TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T00:00:00Z'));

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 2 }))
      .mockResolvedValueOnce(jsonResponse({ data: { records: [] } }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-2', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ data: { records: [] } }));

    const adapter = new TencentDocAdapter({ appId: 'app', appSecret: 'secret', fetcher });
    await adapter.readTable('table-1');

    vi.setSystemTime(new Date('2026-03-17T00:00:03Z'));
    await adapter.readTable('table-1');

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]?.[0]).toBe('https://docs.qq.com/openapi/authen/v1/token');
  });
});
