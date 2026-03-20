import { describe, expect, it, vi } from 'vitest';
import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';
import { createSetupTencentDocTestHandler } from '@/app/api/setup/test-tencentdoc/route';

const workspace = { id: 'workspace-1', name: 'GW-PM' };

describe('setup test-tencentdoc route', () => {
  it('writes a real test record to the first configured project table', async () => {
    const createRecord = vi.fn().mockResolvedValue('record-1');
    const adapter = new TencentDocAdapter();
    vi.spyOn(adapter, 'withWebhookSchema').mockReturnValue({
      createRecord
    } as unknown as TencentDocAdapter);

    const POST = createSetupTencentDocTestHandler({
      ensureWorkspace: vi.fn().mockResolvedValue(workspace),
      listProjects: vi.fn().mockResolvedValue([
        {
          id: 'project-1',
          name: 'Demo',
          taskTableWebhook: 'https://example.com/task-webhook',
          taskTableSchema: { f1: '任务名', f2: '状态', f3: '工种', f4: '估算工时', f5: '优先级' }
        }
      ]),
      getDocAdapter: () => adapter,
      now: () => new Date('2026-03-20T00:00:00.000Z')
    });

    const response = await POST(new Request('http://localhost/api/setup/test-tencentdoc', { method: 'POST' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createRecord).toHaveBeenCalledWith(
      'https://example.com/task-webhook',
      expect.objectContaining({
        任务名: '[GW-PM] 连通性测试 2026-03-20'
      })
    );
    expect(data).toEqual(
      expect.objectContaining({
        success: true,
        projectName: 'Demo',
        tableType: '任务表',
        recordId: 'record-1'
      })
    );
  });

  it('returns 400 when webhook exists but schema is missing', async () => {
    const POST = createSetupTencentDocTestHandler({
      ensureWorkspace: vi.fn().mockResolvedValue(workspace),
      listProjects: vi.fn().mockResolvedValue([
        {
          id: 'project-1',
          name: 'Demo',
          taskTableWebhook: 'https://example.com/task-webhook',
          taskTableSchema: {}
        }
      ]),
      getDocAdapter: () => new TencentDocAdapter(),
      now: () => new Date('2026-03-20T00:00:00.000Z')
    });

    const response = await POST(new Request('http://localhost/api/setup/test-tencentdoc', { method: 'POST' }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('缺少字段映射 schema')
      })
    );
  });
});
