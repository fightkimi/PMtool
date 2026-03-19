import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import { registry } from '@/adapters/registry';
import { cpmEngine, type CPMEngine } from '@/agents/libu_gong/CPMEngine';
import { db } from '@/lib/db';
import { syncTaskRowsToTable } from '@/lib/sync/tableSync';
import { tasks, type InsertTask, type SelectTask } from '@/lib/schema';

type QueueLike = Pick<AgentQueue, 'enqueue'>;

type LibuGongDeps = BaseAgentDeps & {
  cpmEngine?: Pick<CPMEngine, 'computeCriticalPath' | 'cascadeUpdate'>;
  queue?: QueueLike;
  getTasksByIssueNumbers?: (issueNumbers: number[]) => Promise<SelectTask[]>;
  updateTask?: (id: string, data: Partial<InsertTask>) => Promise<void>;
  syncTasksToTable?: (projectId: string, tasks: SelectTask[]) => Promise<void>;
};

export class LibuGongAgent extends BaseAgent {
  readonly agentType = 'libu_gong' as const;

  private readonly cpmEngine: Pick<CPMEngine, 'computeCriticalPath' | 'cascadeUpdate'>;

  private readonly queue: QueueLike;

  private readonly getTasksByIssueNumbersFn: (issueNumbers: number[]) => Promise<SelectTask[]>;

  private readonly updateTaskFn: (id: string, data: Partial<InsertTask>) => Promise<void>;

  private readonly syncTasksToTableFn: (projectId: string, tasks: SelectTask[]) => Promise<void>;

  constructor(deps: LibuGongDeps = {}) {
    super(deps);
    this.cpmEngine = deps.cpmEngine ?? cpmEngine;
    this.queue = deps.queue ?? agentQueue;
    this.getTasksByIssueNumbersFn = deps.getTasksByIssueNumbers ?? defaultGetTasksByIssueNumbers;
    this.updateTaskFn = deps.updateTask ?? defaultUpdateTask;
    this.syncTasksToTableFn =
      deps.syncTasksToTable ?? (async (projectId, taskRows) => syncTaskRowsToTable(projectId, taskRows, registry.getDoc()));
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    if ('run_id' in message.payload) {
      const payload = message.payload as { run_id: string };
      const result = await this.cpmEngine.computeCriticalPath(payload.run_id);
      return this.createMessage('libu_gong', result as unknown as Record<string, unknown>, message.context, 2, 'response');
    }

    if ('stage_instance_id' in message.payload) {
      const payload = message.payload as { stage_instance_id: string; new_end_date: string };
      const result = await this.cpmEngine.cascadeUpdate(payload.stage_instance_id, new Date(payload.new_end_date));
      return this.createMessage('libu_gong', result as unknown as Record<string, unknown>, message.context, 2, 'response');
    }

    const payload = message.payload as { issue_numbers: number[]; repo: string; project_id: string };
    const relatedTasks = await this.getTasksByIssueNumbersFn(payload.issue_numbers);
    for (const task of relatedTasks) {
      await this.updateTaskFn(task.id, {
        status: 'done',
        completedAt: new Date()
      });
    }
    await this.syncTasksToTableFn(payload.project_id, relatedTasks);
    await this.queue.enqueue({
      id: randomUUID(),
      from: 'libu_gong',
      to: 'libu_li2',
      type: 'request',
      payload: {
        type: 'progress_update',
        issue_numbers: payload.issue_numbers,
        repo: payload.repo,
        project_id: payload.project_id
      },
      context: message.context,
      priority: 2,
      created_at: new Date().toISOString()
    });
    return this.createMessage(
      'libu_gong',
      { updated_task_ids: relatedTasks.map((task) => task.id) },
      message.context,
      2,
      'response'
    );
  }
}

const libuGongAgent = new LibuGongAgent();

export default libuGongAgent;

async function defaultGetTasksByIssueNumbers(issueNumbers: number[]): Promise<SelectTask[]> {
  if (issueNumbers.length === 0) {
    return [];
  }

  return db.select().from(tasks).where(inArray(tasks.githubIssueNumber, issueNumbers));
}

async function defaultUpdateTask(id: string, data: Partial<InsertTask>): Promise<void> {
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}
