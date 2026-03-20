import { BaseAgent } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';

type BudgetItem = {
  title?: string;
  department?: string | null;
  estimated_hours?: number | string | null;
};

const DEFAULT_HOURLY_RATES: Record<string, number> = {
  libu_li: 120,
  libu_hu: 110,
  libu_li2: 100,
  libu_bing: 100,
  libu_xing: 90,
  libu_gong: 130
};

function normalizeHours(value: number | string | null | undefined): number {
  const hours = Number(value ?? 0);
  return Number.isFinite(hours) ? hours : 0;
}

function normalizeItems(payload: Record<string, unknown>): BudgetItem[] {
  if (Array.isArray(payload.items)) {
    return payload.items as BudgetItem[];
  }

  if (payload.title || payload.estimated_hours || payload.department) {
    return [
      {
        title: typeof payload.title === 'string' ? payload.title : '未命名事项',
        department: typeof payload.department === 'string' ? payload.department : null,
        estimated_hours:
          typeof payload.estimated_hours === 'number' || typeof payload.estimated_hours === 'string'
            ? payload.estimated_hours
            : null
      }
    ];
  }

  return [];
}

export class LibuHuAgent extends BaseAgent {
  readonly agentType = 'libu_hu' as const;

  constructor() {
    super();
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as Record<string, unknown>;
    const items = normalizeItems(payload);
    const contingencyRate = Number(payload.contingency_rate ?? 0.15);
    const budgetTotal =
      typeof payload.budget_total === 'number' || typeof payload.budget_total === 'string'
        ? Number(payload.budget_total)
        : null;

    const rows = items.map((item) => {
      const department = item.department ?? 'libu_li';
      const estimatedHours = normalizeHours(item.estimated_hours);
      const hourlyRate = DEFAULT_HOURLY_RATES[department] ?? DEFAULT_HOURLY_RATES.libu_li;
      return {
        title: item.title ?? '未命名事项',
        department,
        estimated_hours: estimatedHours,
        hourly_rate: hourlyRate,
        estimated_cost: Math.round(estimatedHours * hourlyRate)
      };
    });

    const subtotalCost = rows.reduce((sum, row) => sum + row.estimated_cost, 0);
    const contingencyCost = Math.round(subtotalCost * contingencyRate);
    const estimatedCost = subtotalCost + contingencyCost;
    const warnings = [
      ...rows
        .filter((row) => row.estimated_hours <= 0)
        .map((row) => `${row.title} 缺少有效工时估算`),
      ...(budgetTotal != null && estimatedCost > budgetTotal
        ? [`预计成本 ${estimatedCost} 超出预算 ${budgetTotal}`]
        : [])
    ];

    return this.createMessage(
      'libu_hu',
      {
        estimated_cost: estimatedCost,
        subtotal_cost: subtotalCost,
        contingency_cost: contingencyCost,
        contingency_rate: contingencyRate,
        budget_total: budgetTotal,
        within_budget: budgetTotal == null ? null : estimatedCost <= budgetTotal,
        warnings,
        items: rows
      },
      message.context,
      2,
      'response'
    );
  }
}

const libuHuAgent = new LibuHuAgent();

export default libuHuAgent;
