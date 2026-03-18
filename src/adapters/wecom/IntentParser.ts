export type IntentType =
  | 'parse_requirement'
  | 'weekly_report'
  | 'risk_scan'
  | 'capacity_evaluate'
  | 'capacity_forecast'
  | 'change_request'
  | 'postmortem'
  | 'unknown';

const intentKeywords: Record<Exclude<IntentType, 'unknown'>, string[]> = {
  parse_requirement: ['分析需求', '看看这个需求', '分析一下', '这个需求', '需求文档'],
  weekly_report: ['本周进度', '进度怎么样', '项目进展', '周报', '进度汇报'],
  risk_scan: ['风险', '有没有问题', '卡住了吗', '阻塞', '什么风险'],
  capacity_evaluate: ['能接吗', '接单', '工期评估', '能做吗', '接得下来吗'],
  capacity_forecast: ['产能', '下月计划', '余量', '还有多少人', '人力情况'],
  change_request: ['延期', '推迟', '变更', '需求改了', '时间来不及', '调整排期'],
  postmortem: ['复盘', '总结', '项目结束', '项目收尾']
};

const intentPriority: Array<Exclude<IntentType, 'unknown'>> = [
  'change_request',
  'risk_scan',
  'capacity_evaluate',
  'capacity_forecast',
  'weekly_report',
  'postmortem',
  'parse_requirement'
];

function extractParams(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  const separators = ['：', ':', '=', '为'];

  for (const segment of text.split(/[，,\n；;]/)) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const separator = separators.find((item) => trimmed.includes(item));
    if (!separator) {
      continue;
    }

    const [rawKey, ...rest] = trimmed.split(separator);
    const key = rawKey.trim();
    const value = rest.join(separator).trim();
    if (key && value) {
      params[key] = value;
    }
  }

  return params;
}

export function parse(text: string): { intent: IntentType; params: Record<string, string> } {
  const normalized = text.trim();
  const params = extractParams(normalized);

  for (const intent of intentPriority) {
    const keywords = intentKeywords[intent];
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return { intent, params };
    }
  }

  return { intent: 'unknown', params };
}
