import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import type { DocAdapter } from '@/adapters/types';
import type { SelectPipelineStageInstance, SelectProject, SelectRisk, SelectTask } from '@/lib/schema';
import {
  batchSyncTasksToTable,
  getProjectForSync,
  syncRiskToTable,
  syncStageByIdToTable,
  syncStageToTable,
  syncTaskToTable,
  tableRecordToTaskFields
} from '@/lib/sync/tableSync';
import * as projectQueries from '@/lib/queries/projects';
import * as taskQueries from '@/lib/queries/tasks';

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: null,
  wecomGroupId: null,
  wecomBotWebhook: null,
  wecomMgmtGroupId: null,
  smartTableRootId: null,
  taskTableId: 'task-table-1',
  pipelineTableId: null,
  capacityTableId: null,
  riskTableId: null,
  changeTableId: null,
  githubRepo: null,
  budget: { total: 0, spent: 0, token_budget: 0 },
  startedAt: null,
  dueAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function createTask(id: string, tableRecordId: string | null = null): SelectTask {
  return {
    id,
    projectId: 'project-1',
    parentId: null,
    title: `任务-${id}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    reviewerId: null,
    department: 'libu_gong',
    estimatedHours: '8',
    actualHours: '0',
    earliestStart: null,
    latestFinish: null,
    floatDays: null,
    githubIssueNumber: null,
    acceptanceCriteria: [],
    tableRecordId,
    dueAt: new Date('2026-03-20T00:00:00.000Z'),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function createStage(tableRecordId: string | null = null): SelectPipelineStageInstance {
  return {
    id: 'stage-1',
    runId: 'run-1',
    stageKey: 'A1',
    roleType: 'ui_designer',
    assigneeId: 'u1',
    plannedStart: new Date('2026-03-18T00:00:00.000Z'),
    plannedEnd: new Date('2026-03-20T00:00:00.000Z'),
    actualStart: null,
    actualEnd: null,
    estimatedHours: '16',
    dependsOn: [],
    floatDays: '0',
    status: 'pending',
    tableRecordId,
    taskId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function createRisk(tableRecordId: string | null = null): SelectRisk {
  return {
    id: 'risk-1',
    projectId: 'project-1',
    taskId: null,
    runId: null,
    level: 'high',
    description: '风险描述',
    status: 'open',
    mitigation: null,
    detectedBy: 'agent',
    tableRecordId,
    lastSeenAt: new Date(),
    createdAt: new Date('2026-03-17T00:00:00.000Z'),
    resolvedAt: null
  };
}

function createDocAdapter(recordId = 'row-001'): DocAdapter {
  return {
    readTable: vi.fn(),
    createRecord: vi.fn().mockResolvedValue(recordId),
    updateRecord: vi.fn().mockResolvedValue(undefined),
    batchUpdate: vi.fn().mockResolvedValue(undefined),
    findRecord: vi.fn().mockResolvedValue(null),
    createTable: vi.fn().mockResolvedValue('table-1')
  };
}

describe('tableSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates record and stores table_record_id on first sync', async () => {
    const task = createTask('task-1', null);
    const docAdapter = createDocAdapter('row-001');
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never);

    await syncTaskToTable(task, projectFixture, docAdapter);

    expect(docAdapter.createRecord).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ tableRecordId: 'row-001' });
    expect(docAdapter.updateRecord).not.toHaveBeenCalled();
  });

  it('updates existing record when table_record_id is present', async () => {
    const task = createTask('task-1', 'row-001');
    const docAdapter = createDocAdapter('row-001');

    await syncTaskToTable(task, projectFixture, docAdapter);

    expect(docAdapter.updateRecord).toHaveBeenCalledWith(
      'task-table-1',
      'row-001',
      expect.objectContaining({
        任务名: '任务-task-1'
      })
    );
    expect(docAdapter.createRecord).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated syncs of the same task object', async () => {
    const task = createTask('task-1', null);
    const docAdapter = createDocAdapter('row-001');
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockImplementation((value) => {
      task.tableRecordId = value.tableRecordId;
      return { where: whereMock };
    });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never);

    await syncTaskToTable(task, projectFixture, docAdapter);
    await syncTaskToTable(task, projectFixture, docAdapter);
    await syncTaskToTable(task, projectFixture, docAdapter);

    expect(docAdapter.createRecord).toHaveBeenCalledTimes(1);
    expect(docAdapter.updateRecord).toHaveBeenCalledTimes(2);
  });

  it('batch syncs all tasks in the project', async () => {
    const docAdapter = createDocAdapter('row-001');
    const taskRows = [
      createTask('task-1'),
      createTask('task-2', 'row-002'),
      createTask('task-3'),
      createTask('task-4', 'row-004'),
      createTask('task-5')
    ];
    vi.spyOn(projectQueries, 'getProjectById').mockResolvedValue(projectFixture);
    vi.spyOn(taskQueries, 'getTasksByProject').mockResolvedValue(taskRows);
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockImplementation((value) => {
      const task = taskRows.find((item) => item.id === value.id);
      if (task && typeof value.tableRecordId === 'string') {
        task.tableRecordId = value.tableRecordId;
      }
      return { where: whereMock };
    });
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: whereMock }) } as never);

    await batchSyncTasksToTable('project-1', docAdapter);

    expect((docAdapter.createRecord as unknown as ReturnType<typeof vi.fn>).mock.calls.length + (docAdapter.updateRecord as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(5);
  });

  it('syncs pipeline stage and risk records to their tables', async () => {
    const docAdapter = createDocAdapter('row-010');
    const stage = createStage();
    const risk = createRisk();
    const whereMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: whereMock }) } as never);

    await syncStageToTable(stage, { ...projectFixture, pipelineTableId: 'pipeline-table-1' }, 'Run-1', docAdapter);
    await syncRiskToTable(risk, { ...projectFixture, riskTableId: 'risk-table-1' }, docAdapter);

    expect(docAdapter.createRecord).toHaveBeenCalledTimes(2);
  });

  it('updates existing stage and risk rows when table_record_id already exists', async () => {
    const docAdapter = createDocAdapter('row-010');
    const stage = createStage('row-stage');
    const risk = createRisk('row-risk');

    await syncStageToTable(stage, { ...projectFixture, pipelineTableId: 'pipeline-table-1' }, 'Run-1', docAdapter);
    await syncRiskToTable(risk, { ...projectFixture, riskTableId: 'risk-table-1' }, docAdapter);

    expect(docAdapter.updateRecord).toHaveBeenCalledWith(
      'pipeline-table-1',
      'row-stage',
      expect.objectContaining({ 阶段编号: 'A1' })
    );
    expect(docAdapter.updateRecord).toHaveBeenCalledWith(
      'risk-table-1',
      'row-risk',
      expect.objectContaining({ 风险描述: '风险描述' })
    );
    expect(docAdapter.createRecord).not.toHaveBeenCalled();
  });

  it('syncStageByIdToTable loads run name before syncing the record', async () => {
    const docAdapter = createDocAdapter('row-stage');
    const whereStageMock = vi
      .fn()
      .mockResolvedValueOnce([createStage()])
      .mockResolvedValueOnce([{ id: 'run-1', name: 'Run-1' }]);
    const fromMock = vi.fn().mockReturnValue({ where: whereStageMock });
    const whereUpdateMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: whereUpdateMock }) } as never);

    await syncStageByIdToTable('stage-1', { ...projectFixture, pipelineTableId: 'pipeline-table-1' }, docAdapter);

    expect(docAdapter.createRecord).toHaveBeenCalledWith(
      'pipeline-table-1',
      expect.objectContaining({ Run名: 'Run-1' })
    );
  });

  it('maps safe fields from table record back to task updates', () => {
    const fields = tableRecordToTaskFields({
      状态: 'done',
      实际工时: 12,
      截止日期: '2026-03-20'
    });

    expect(fields).toEqual(
      expect.objectContaining({
        status: 'done',
        actualHours: '12'
      })
    );
    expect(fields.dueAt).toBeInstanceOf(Date);
  });

  it('getProjectForSync returns the first matching project', async () => {
    const whereMock = vi.fn().mockResolvedValue([projectFixture]);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getProjectForSync('project-1');

    expect(result).toEqual(projectFixture);
  });
});
