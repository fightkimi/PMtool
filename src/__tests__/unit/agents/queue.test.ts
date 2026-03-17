import { describe, expect, it, vi } from 'vitest';
import { AgentQueue } from '@/agents/base/AgentQueue';
import type { AgentMessage } from '@/agents/base/types';
import type { AgentRouter } from '@/agents/base/AgentRouter';

const baseMessage: AgentMessage = {
  id: 'msg-1',
  from: 'zhongshui',
  to: 'libu_bing',
  type: 'request',
  payload: {},
  context: {
    workspace_id: 'workspace-1',
    job_id: 'job-1',
    trace_ids: []
  },
  priority: 2,
  created_at: new Date('2026-03-17T00:00:00Z').toISOString()
};

describe('AgentQueue', () => {
  it('maps priority=1 to BullMQ priority 10', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'bull-job-1' });
    class FakeQueue {
      add = add;
      getJob = vi.fn();
      constructor(_name: string, _options: unknown) {}
    }

    const queue = new AgentQueue({ QueueClass: FakeQueue as never, WorkerClass: class {} as never });
    await queue.enqueue({ ...baseMessage, priority: 1 });

    expect(add).toHaveBeenCalledWith(
      'libu_bing',
      expect.any(Object),
      expect.objectContaining({ priority: 10 })
    );
  });

  it('maps priority=3 to BullMQ priority 1', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'bull-job-2' });
    class FakeQueue {
      add = add;
      getJob = vi.fn();
      constructor(_name: string, _options: unknown) {}
    }

    const queue = new AgentQueue({ QueueClass: FakeQueue as never, WorkerClass: class {} as never });
    await queue.enqueue({ ...baseMessage, priority: 3 });

    expect(add).toHaveBeenCalledWith(
      'libu_bing',
      expect.any(Object),
      expect.objectContaining({ priority: 1 })
    );
  });

  it('createWorker uses concurrency 5', () => {
    const add = vi.fn();
    const getJob = vi.fn();
    const workerCtor = vi.fn().mockImplementation(function FakeWorker() {});

    class FakeQueue {
      add = add;
      getJob = getJob;
      constructor(_name: string, _options: unknown) {}
    }

    const queue = new AgentQueue({
      QueueClass: FakeQueue as never,
      WorkerClass: workerCtor as never,
      connectionUrl: 'redis://localhost:6379'
    });

    queue.createWorker({ route: vi.fn() } as unknown as AgentRouter);

    expect(workerCtor).toHaveBeenCalledWith(
      'gw-pm-agents',
      expect.any(Function),
      expect.objectContaining({ concurrency: 5 })
    );
  });
});
