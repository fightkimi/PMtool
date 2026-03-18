import { describe, expect, it, vi } from 'vitest';
import { LibuGongAgent } from '@/agents/libu_gong/LibuGongAgent';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import { db } from '@/lib/db';
import type { SelectTask } from '@/lib/schema';

function createRegistry() {
  const im: IMAdapter = {
    sendMessage: vi.fn(),
    sendMarkdown: vi.fn(),
    sendCard: vi.fn(),
    sendDM: vi.fn(),
    parseIncoming: vi.fn(),
    getGroupMembers: vi.fn()
  };
  const ai: AIAdapter = {
    chat: vi.fn(),
    stream: vi.fn()
  };

  return {
    registry: {
      getIM: () => im,
      getAI: () => ai
    }
  };
}

const relatedTasks: SelectTask[] = [
  {
    id: 'task-1',
    projectId: 'project-1',
    parentId: null,
    title: 'Issue 1',
    description: null,
    status: 'review',
    priority: 'medium',
    assigneeId: null,
    reviewerId: null,
    department: 'libu_gong',
    estimatedHours: 8,
    actualHours: null,
    earliestStart: null,
    latestFinish: null,
    floatDays: null,
    githubIssueNumber: 1,
    acceptanceCriteria: [],
    tableRecordId: null,
    dueAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

describe('LibuGongAgent', () => {
  it('delegates CPM calculations', async () => {
    const computeCriticalPath = vi.fn().mockResolvedValue({ critical_path: [], float_map: {}, conflicts: [] });
    const cascadeUpdate = vi.fn().mockResolvedValue({ affected_stage_ids: [], milestone_impact: false, conflicts: [] });
    const agent = new LibuGongAgent({
      ...createRegistry(),
      cpmEngine: { computeCriticalPath, cascadeUpdate }
    });

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'libu_gong',
      type: 'request',
      payload: { run_id: 'run-1' },
      context: { workspace_id: 'workspace-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });
    await agent.handle({
      id: 'msg-2',
      from: 'zhongshui',
      to: 'libu_gong',
      type: 'request',
      payload: { stage_instance_id: 'stage-1', new_end_date: '2026-03-20T00:00:00.000Z' },
      context: { workspace_id: 'workspace-1', job_id: 'job-2', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(computeCriticalPath).toHaveBeenCalledWith('run-1');
    expect(cascadeUpdate).toHaveBeenCalledWith('stage-1', new Date('2026-03-20T00:00:00.000Z'));
  });

  it('marks related tasks done after PR merge and enqueues progress update', async () => {
    const queue = { enqueue: vi.fn().mockResolvedValue('job-1') };
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const syncTasksToTable = vi.fn().mockResolvedValue(undefined);
    const agent = new LibuGongAgent({
      ...createRegistry(),
      queue,
      getTasksByIssueNumbers: vi.fn().mockResolvedValue(relatedTasks),
      updateTask,
      syncTasksToTable
    });

    await agent.handle({
      id: 'msg-3',
      from: 'zhongshui',
      to: 'libu_gong',
      type: 'request',
      payload: { issue_numbers: [1], repo: 'fightkimi/PMtool', project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-3', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'done'
      })
    );
    expect(syncTasksToTable).toHaveBeenCalledWith('project-1', relatedTasks);
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'libu_li2'
      })
    );
  });

  it('uses default task lookup and update helpers when deps are not injected', async () => {
    const queue = { enqueue: vi.fn().mockResolvedValue('job-2') };
    const syncTasksToTable = vi.fn().mockResolvedValue(undefined);
    const whereSelectMock = vi.fn().mockResolvedValue(relatedTasks);
    const fromSelectMock = vi.fn().mockReturnValue({ where: whereSelectMock });
    const whereUpdateMock = vi.fn().mockResolvedValue(undefined);
    const setUpdateMock = vi.fn().mockReturnValue({ where: whereUpdateMock });
    vi.mocked(db.select).mockReturnValue({ from: fromSelectMock } as never);
    vi.mocked(db.update).mockReturnValue({ set: setUpdateMock } as never);

    const agent = new LibuGongAgent({
      ...createRegistry(),
      queue,
      syncTasksToTable
    });

    await agent.handle({
      id: 'msg-4',
      from: 'zhongshui',
      to: 'libu_gong',
      type: 'request',
      payload: { issue_numbers: [1], repo: 'fightkimi/PMtool', project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-4', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(db.select).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
    expect(syncTasksToTable).toHaveBeenCalledWith('project-1', relatedTasks);
  });
});
