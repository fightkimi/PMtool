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

describe('specialized agents', () => {
  it('LibuHuAgent estimates cost and budget risk', async () => {
    const agent = new LibuHuAgent();
    const result = await agent.handle({
      ...baseMessage,
      to: 'libu_hu',
      payload: {
        items: [
          { title: '开发登录功能', department: 'libu_gong', estimated_hours: 10 },
          { title: '补充验收测试', department: 'libu_xing', estimated_hours: 4 }
        ],
        budget_total: 1000
      }
    });

    expect(result.from).toBe('libu_hu');
    expect(result.payload).toEqual(
      expect.objectContaining({
        subtotal_cost: 1660,
        contingency_cost: 249,
        estimated_cost: 1909,
        within_budget: false,
        warnings: ['预计成本 1909 超出预算 1000']
      })
    );
  });

  it('LibuXingAgent builds QA checklist and flags missing acceptance criteria', async () => {
    const agent = new LibuXingAgent();
    const result = await agent.handle({
      ...baseMessage,
      to: 'libu_xing',
      payload: {
        title: '登录优化',
        description: '补齐异常提示并优化登录流程',
        acceptance_criteria: ['错误密码时提示正确', '登录成功后跳转首页']
      }
    });

    expect(result.from).toBe('libu_xing');
    expect(result.payload).toEqual(
      expect.objectContaining({
        qa_ready: true,
        suggested_status: 'review',
        issues: [],
        checklist: expect.arrayContaining([
          '验证：错误密码时提示正确',
          '验证：登录成功后跳转首页',
          '验证正确/错误账号密码登录链路'
        ])
      })
    );
  });

  it('LibuXingAgent blocks tasks without enough QA context', async () => {
    const agent = new LibuXingAgent();
    const result = await agent.handle({
      ...baseMessage,
      to: 'libu_xing',
      payload: {
        title: '测',
        description: '太短',
        acceptance_criteria: []
      }
    });

    expect(result.payload).toEqual(
      expect.objectContaining({
        qa_ready: false,
        suggested_status: 'blocked',
        issues: expect.arrayContaining([
          '任务标题过短，无法形成有效测试目标',
          '任务描述过短，缺少足够测试上下文',
          '缺少验收标准，无法形成明确测试结论'
        ])
      })
    );
  });
});
