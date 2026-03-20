import { BaseAgent } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';

type QaPayload = {
  title?: string;
  description?: string;
  acceptance_criteria?: string[];
};

function normalizeCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function buildExtraChecks(text: string): string[] {
  const checks: string[] = ['验证异常输入与错误提示'];
  if (/(登录|login)/iu.test(text)) {
    checks.push('验证正确/错误账号密码登录链路');
  }
  if (/(支付|扣费|订单)/iu.test(text)) {
    checks.push('验证金额、状态流转与重复提交保护');
  }
  if (/(导出|下载)/iu.test(text)) {
    checks.push('验证导出内容、格式与文件权限');
  }
  return checks;
}

export class LibuXingAgent extends BaseAgent {
  readonly agentType = 'libu_xing' as const;

  constructor() {
    super();
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as QaPayload;
    const title = payload.title?.trim() ?? '';
    const description = payload.description?.trim() ?? '';
    const criteria = normalizeCriteria(payload.acceptance_criteria);
    const combined = `${title} ${description}`.trim();

    const issues = [
      ...(title.length < 4 ? ['任务标题过短，无法形成有效测试目标'] : []),
      ...(description.length < 10 ? ['任务描述过短，缺少足够测试上下文'] : []),
      ...(criteria.length === 0 ? ['缺少验收标准，无法形成明确测试结论'] : [])
    ];

    const checklist = [
      ...criteria.map((item) => `验证：${item}`),
      ...buildExtraChecks(combined)
    ];

    return this.createMessage(
      'libu_xing',
      {
        qa_ready: issues.length === 0,
        suggested_status: issues.length === 0 ? 'review' : 'blocked',
        issues,
        checklist: [...new Set(checklist)]
      },
      message.context,
      2,
      'response'
    );
  }
}

const libuXingAgent = new LibuXingAgent();

export default libuXingAgent;
