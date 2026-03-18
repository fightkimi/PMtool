import { Job, Queue, Worker } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import type { AgentMessage } from './types';
import type { AgentRouter } from './AgentRouter';
import { agentLogger } from '@/workers/logger';

type QueueLike = {
  add: (name: string, data: AgentMessage, opts?: JobsOptions) => Promise<{ id?: string | number }>;
  getJob: (jobId: string) => Promise<{ getState: () => Promise<string> } | null>;
};

type QueueCtor = new (
  name: string,
  options: {
    connection: { url: string };
  }
) => QueueLike;

type WorkerCtor = new (
  name: string,
  processor: (job: Job) => Promise<void>,
  options: {
    connection: { url: string };
    concurrency: number;
  }
) => Worker;

type AgentQueueDeps = {
  QueueClass?: QueueCtor;
  WorkerClass?: WorkerCtor;
  connectionUrl?: string;
};

function mapPriority(priority: AgentMessage['priority']): number {
  if (priority === 1) {
    return 10;
  }

  if (priority === 3) {
    return 1;
  }

  return 5;
}

export class AgentQueue {
  private readonly QueueClass: QueueCtor;

  private readonly WorkerClass: WorkerCtor;

  private readonly connectionUrl: string;

  private queue?: QueueLike;

  constructor(deps: AgentQueueDeps = {}) {
    this.QueueClass = deps.QueueClass ?? (Queue as unknown as QueueCtor);
    this.WorkerClass = deps.WorkerClass ?? (Worker as unknown as WorkerCtor);
    this.connectionUrl = deps.connectionUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  }

  async enqueue(message: AgentMessage, options?: { delay?: number }): Promise<string> {
    agentLogger.agentStart(message.from, message.to, message.payload);
    const job = await this.getQueue().add(message.to, message, {
      delay: options?.delay,
      priority: mapPriority(message.priority)
    });

    return String(job.id ?? '');
  }

  async getJobStatus(jobId: string): Promise<string> {
    const job = await this.getQueue().getJob(jobId);
    if (!job) {
      return 'not_found';
    }

    return job.getState();
  }

  createWorker(router: AgentRouter): Worker {
    return new this.WorkerClass(
      'gw-pm-agents',
      async (job: Job) => {
        const message = job.data as AgentMessage;
        await router.route(message);
      },
      {
        connection: { url: this.connectionUrl },
        concurrency: 5
      }
    );
  }

  private getQueue(): QueueLike {
    if (!this.queue) {
      this.queue = new this.QueueClass('gw-pm-agents', {
        connection: { url: this.connectionUrl }
      });
    }

    return this.queue;
  }
}

export const agentQueue = new AgentQueue();
