import { describe, expect, it, vi } from 'vitest';
import { TableInitializer } from '@/adapters/tencentdoc/TableInitializer';
import type { DocAdapter } from '@/adapters/types';

describe('TableInitializer', () => {
  it('creates five standard project tables', async () => {
    const docAdapter: DocAdapter = {
      readTable: vi.fn(),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      batchUpdate: vi.fn(),
      findRecord: vi.fn(),
      createTable: vi
        .fn()
        .mockResolvedValueOnce('task-table')
        .mockResolvedValueOnce('pipeline-table')
        .mockResolvedValueOnce('capacity-table')
        .mockResolvedValueOnce('risk-table')
        .mockResolvedValueOnce('change-table')
    };
    const initializer = new TableInitializer(docAdapter);

    const result = await initializer.initProjectTables('root-1', '项目A');

    expect(docAdapter.createTable).toHaveBeenCalledTimes(5);
    expect(result).toEqual({
      task_table_webhook: 'task-table',
      pipeline_table_webhook: 'pipeline-table',
      capacity_table_webhook: 'capacity-table',
      risk_table_webhook: 'risk-table',
      change_table_webhook: 'change-table'
    });
  });
});
