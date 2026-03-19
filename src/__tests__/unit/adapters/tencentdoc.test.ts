import { describe, expect, it, vi } from 'vitest';
import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('TencentDocAdapter', () => {
  it('buildValues converts text field values with schema mapping', () => {
    const adapter = new TencentDocAdapter();

    expect(
      adapter.buildValues(
        { 功能: '测试' },
        {
          f8b2fT: '功能'
        }
      )
    ).toEqual({
      f8b2fT: [{ text: '测试' }]
    });
  });

  it('buildValues converts number field values with schema mapping', () => {
    const adapter = new TencentDocAdapter();

    expect(
      adapter.buildValues(
        { 人天: 3 },
        {
          fSNPFZ: '人天'
        }
      )
    ).toEqual({
      fSNPFZ: 3
    });
  });

  it('createRecord uses add_records payload and returns record id', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        errcode: 0,
        add_records: [{ record_id: 'record-1' }]
      })
    );
    const adapter = new TencentDocAdapter({
      fetcher,
      webhookSchemas: {
        'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx': {
          f8b2fT: '功能',
          fSNPFZ: '人天'
        }
      }
    });

    const recordId = await adapter.createRecord('https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx', {
      功能: 'GW-PM 连接测试',
      人天: 1
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload).toEqual({
      add_records: [
        {
          values: {
            f8b2fT: [{ text: 'GW-PM 连接测试' }],
            fSNPFZ: 1
          }
        }
      ]
    });
    expect(payload).not.toHaveProperty('records');
    expect(recordId).toBe('record-1');
  });

  it('createRecord throws when webhook returns non-zero errcode', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        errcode: 40001,
        errmsg: 'invalid key'
      })
    );
    const adapter = new TencentDocAdapter({ fetcher });

    await expect(
      adapter.createRecord('https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx', {
        功能: '测试'
      })
    ).rejects.toThrow('invalid key');
  });

  it('batchUpdate splits requests into chunks of 100 using update_records format', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ errcode: 0 }));
    const adapter = new TencentDocAdapter({
      fetcher,
      webhookSchemas: {
        'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx': {
          fmAHg0: '进度'
        }
      }
    });
    const updates = Array.from({ length: 205 }, (_, index) => ({
      id: `record-${index + 1}`,
      fields: { 进度: index + 1 }
    }));

    await adapter.batchUpdate('https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx', updates);

    expect(fetcher).toHaveBeenCalledTimes(3);
    const firstBatch = JSON.parse(String((fetcher.mock.calls[0] as [string, RequestInit])[1].body));
    const lastBatch = JSON.parse(String((fetcher.mock.calls[2] as [string, RequestInit])[1].body));
    expect(firstBatch.update_records).toHaveLength(100);
    expect(lastBatch.update_records).toHaveLength(5);
  });

  it('readTable returns an empty array in webhook mode', async () => {
    const adapter = new TencentDocAdapter();

    await expect(adapter.readTable('https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx')).resolves.toEqual(
      []
    );
  });
});
