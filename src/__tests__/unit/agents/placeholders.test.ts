import { describe, expect, it } from 'vitest';
import { LibuHuAgent } from '@/agents/libu_hu/LibuHuAgent';
import { LibuXingAgent } from '@/agents/libu_xing/LibuXingAgent';

const baseMessage = {
  id: 'msg-1',
  from: 'zhongshui' as const,
  type: 'request' as const,
  payload: { ping: true },
  context: {
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    job_id: 'job-1',
    trace_ids: []
  },
  priority: 2 as const,
  created_at: new Date().toISOString()
};

describe('placeholder agents', () => {
  it('LibuHuAgent echoes a handled response', async () => {
    const agent = new LibuHuAgent();
    const result = await agent.handle({
      ...baseMessage,
      to: 'libu_hu'
    });

    expect(result.from).toBe('libu_hu');
    expect(result.payload).toEqual({
      handled: true,
      payload: { ping: true }
    });
  });

  it('LibuXingAgent echoes a handled response', async () => {
    const agent = new LibuXingAgent();
    const result = await agent.handle({
      ...baseMessage,
      to: 'libu_xing'
    });

    expect(result.from).toBe('libu_xing');
    expect(result.payload).toEqual({
      handled: true,
      payload: { ping: true }
    });
  });
});
