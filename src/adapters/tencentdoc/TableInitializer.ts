import type { DocAdapter, DocField } from '@/adapters/types';

const taskFields: DocField[] = [
  { name: '任务名', type: 'text' },
  { name: '状态', type: 'select' },
  { name: '负责人', type: 'member' },
  { name: '工种', type: 'text' },
  { name: '估算工时', type: 'number' },
  { name: '实际工时', type: 'number' },
  { name: '截止日期', type: 'date' },
  { name: '优先级', type: 'select' }
];

const pipelineFields: DocField[] = [
  { name: 'Run名', type: 'text' },
  { name: '阶段编号', type: 'text' },
  { name: '工种', type: 'text' },
  { name: '负责人', type: 'member' },
  { name: '计划开始', type: 'date' },
  { name: '计划结束', type: 'date' },
  { name: '浮动天数', type: 'number' },
  { name: '状态', type: 'select' }
];

const capacityFields: DocField[] = [
  { name: '成员', type: 'member' },
  { name: '工种', type: 'text' },
  { name: '周期', type: 'date' },
  { name: '可用工时', type: 'number' },
  { name: '已分配', type: 'number' },
  { name: '负载率', type: 'number' }
];

const riskFields: DocField[] = [
  { name: '风险描述', type: 'text' },
  { name: '等级', type: 'select' },
  { name: '发现时间', type: 'date' },
  { name: '状态', type: 'select' },
  { name: '处理人', type: 'member' }
];

const changeFields: DocField[] = [
  { name: '变更标题', type: 'text' },
  { name: '提出人', type: 'member' },
  { name: '影响天数', type: 'number' },
  { name: '状态', type: 'select' },
  { name: '执行时间', type: 'date' }
];

export class TableInitializer {
  constructor(private docAdapter: DocAdapter) {}

  async initProjectTables(rootId: string, projectName: string): Promise<{
    task_table_webhook: string;
    pipeline_table_webhook: string;
    capacity_table_webhook: string;
    risk_table_webhook: string;
    change_table_webhook: string;
  }> {
    const [taskTableWebhook, pipelineTableWebhook, capacityTableWebhook, riskTableWebhook, changeTableWebhook] = await Promise.all([
      this.docAdapter.createTable(rootId, `${projectName}_任务总表`, taskFields),
      this.docAdapter.createTable(rootId, `${projectName}_管线排期表`, pipelineFields),
      this.docAdapter.createTable(rootId, `${projectName}_产能热力图`, capacityFields),
      this.docAdapter.createTable(rootId, `${projectName}_风险台账`, riskFields),
      this.docAdapter.createTable(rootId, `${projectName}_变更记录`, changeFields)
    ]);

    return {
      task_table_webhook: taskTableWebhook,
      pipeline_table_webhook: pipelineTableWebhook,
      capacity_table_webhook: capacityTableWebhook,
      risk_table_webhook: riskTableWebhook,
      change_table_webhook: changeTableWebhook
    };
  }
}
