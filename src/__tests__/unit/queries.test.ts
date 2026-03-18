import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { createAgentJob, getJobsByType, updateAgentJob } from '@/lib/queries/agent_jobs';
import { getStagesByAssignee, getStagesByRun, batchUpdateStages } from '@/lib/queries/pipeline_stage_instances';
import { getActiveProjects, getProjectById, updateProjectStatus } from '@/lib/queries/projects';
import { batchInsertTasks, getTaskById, getTasksByProject, updateTaskStatus } from '@/lib/queries/tasks';
import {
  agentJobs,
  pipelineStageInstances,
  projects,
  tasks,
  type InsertAgentJob,
  type InsertTask,
  type SelectAgentJob,
  type SelectPipelineStageInstance,
  type SelectProject,
  type SelectTask
} from '@/lib/schema';

describe('queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getProjectById returns the first matching project', async () => {
    const project = {
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
      taskTableId: null,
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
    } satisfies SelectProject;

    const whereMock = vi.fn().mockResolvedValue([project]);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getProjectById('project-1');

    expect(db.select).toHaveBeenCalledWith();
    expect(fromMock).toHaveBeenCalledWith(projects);
    expect(result).toEqual(project);
  });

  it('getActiveProjects returns matching active projects', async () => {
    const rows = [{ id: 'project-2' }] as SelectProject[];
    const whereMock = vi.fn().mockResolvedValue(rows);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getActiveProjects('workspace-1');

    expect(fromMock).toHaveBeenCalledWith(projects);
    expect(result).toEqual(rows);
  });

  it('updateProjectStatus only updates the status field', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never);

    await updateProjectStatus('project-1', 'paused');

    expect(db.update).toHaveBeenCalledWith(projects);
    expect(setMock).toHaveBeenCalledWith({ status: 'paused' });
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it('batchInsertTasks passes the payload into db.insert', async () => {
    const payload = [
      {
        projectId: 'project-1',
        title: 'Create schema',
        status: 'todo',
        priority: 'medium',
        acceptanceCriteria: []
      }
    ] satisfies InsertTask[];

    const inserted = payload.map((task, index) => ({
      id: `task-${index + 1}`,
      parentId: null,
      description: null,
      assigneeId: null,
      reviewerId: null,
      department: null,
      estimatedHours: null,
      actualHours: null,
      earliestStart: null,
      latestFinish: null,
      floatDays: null,
      githubIssueNumber: null,
      tableRecordId: null,
      dueAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...task
    })) satisfies SelectTask[];

    const returningMock = vi.fn().mockResolvedValue(inserted);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);

    const result = await batchInsertTasks(payload);

    expect(db.insert).toHaveBeenCalledWith(tasks);
    expect(valuesMock).toHaveBeenCalledWith(payload);
    expect(returningMock).toHaveBeenCalledWith();
    expect(result).toEqual(inserted);
  });

  it('updateTaskStatus only updates the status field', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never);

    await updateTaskStatus('task-1', 'done');

    expect(db.update).toHaveBeenCalledWith(tasks);
    expect(setMock).toHaveBeenCalledWith({ status: 'done' });
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it('getTasksByProject returns all matching tasks', async () => {
    const rows = [
      {
        id: 'task-1',
        projectId: 'project-1'
      }
    ] as SelectTask[];
    const whereMock = vi.fn().mockResolvedValue(rows);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getTasksByProject('project-1');

    expect(fromMock).toHaveBeenCalledWith(tasks);
    expect(result).toEqual(rows);
  });

  it('getTaskById returns null when task does not exist', async () => {
    const whereMock = vi.fn().mockResolvedValue([]);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getTaskById('missing-task');

    expect(result).toBeNull();
  });

  it('getStagesByRun returns all stage instances for the run', async () => {
    const rows = [{ id: 'stage-1', runId: 'run-1' }] as SelectPipelineStageInstance[];
    const whereMock = vi.fn().mockResolvedValue(rows);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getStagesByRun('run-1');

    expect(fromMock).toHaveBeenCalledWith(pipelineStageInstances);
    expect(result).toEqual(rows);
  });

  it('batchUpdateStages updates every stage payload', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never);

    await batchUpdateStages([
      { id: 'stage-1', data: { status: 'active' } },
      { id: 'stage-2', data: { status: 'done', floatDays: 0 } }
    ]);

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenNthCalledWith(1, { status: 'active' });
    expect(setMock).toHaveBeenNthCalledWith(2, { status: 'done', floatDays: 0 });
    expect(whereMock).toHaveBeenCalledTimes(2);
  });

  it('getStagesByAssignee returns rows in the requested window', async () => {
    const rows = [{ id: 'stage-3', assigneeId: 'user-1' }] as SelectPipelineStageInstance[];
    const whereMock = vi.fn().mockResolvedValue(rows);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getStagesByAssignee('user-1', new Date('2026-03-17'), new Date('2026-03-21'));

    expect(fromMock).toHaveBeenCalledWith(pipelineStageInstances);
    expect(result).toEqual(rows);
  });

  it('createAgentJob returns the inserted row', async () => {
    const payload = {
      workspaceId: 'workspace-1',
      agentType: 'zhongshui',
      trigger: 'manual',
      input: { hello: 'world' },
      status: 'pending'
    } satisfies InsertAgentJob;
    const inserted = [{ id: 'job-1', ...payload, output: null, modelUsed: null, tokensInput: 0, tokensOutput: 0, costUsd: '0', errorMessage: null, startedAt: null, finishedAt: null, createdAt: new Date() }] as SelectAgentJob[];
    const returningMock = vi.fn().mockResolvedValue(inserted);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);

    const result = await createAgentJob(payload);

    expect(db.insert).toHaveBeenCalledWith(agentJobs);
    expect(valuesMock).toHaveBeenCalledWith(payload);
    expect(result).toEqual(inserted[0]);
  });

  it('updateAgentJob updates only the provided partial payload', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never);

    await updateAgentJob('job-1', { status: 'success', tokensOutput: 128 });

    expect(db.update).toHaveBeenCalledWith(agentJobs);
    expect(setMock).toHaveBeenCalledWith({ status: 'success', tokensOutput: 128 });
  });

  it('getJobsByType orders rows by created time and applies limit', async () => {
    const rows = [{ id: 'job-2' }] as SelectAgentJob[];
    const limitMock = vi.fn().mockResolvedValue(rows);
    const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const result = await getJobsByType('zhongshui', 5);

    expect(fromMock).toHaveBeenCalledWith(agentJobs);
    expect(orderByMock).toHaveBeenCalledTimes(1);
    expect(limitMock).toHaveBeenCalledWith(5);
    expect(result).toEqual(rows);
  });
});
