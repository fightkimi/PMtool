import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';

async function main() {
  const webhookUrl = process.env.TASK_TABLE_WEBHOOK;
  const schemaJson = process.env.TASK_TABLE_SCHEMA_JSON;
  if (!webhookUrl) {
    console.error('❌ 写入失败: 缺少 TASK_TABLE_WEBHOOK');
    process.exitCode = 1;
    return;
  }

  const schema = schemaJson
    ? (JSON.parse(schemaJson) as Record<string, string>)
    : {
        fzSueb: '所属项目',
        f8b2fT: '功能',
        fiWfNd: '描述',
        fc5FyT: '岗位',
        f53B4X: '优先级',
        fSNPFZ: '人天',
        fCvOty: '备注'
      };

  const adapter = new TencentDocAdapter({ webhookSchemas: { [webhookUrl]: schema } });

  try {
    const recordId = await adapter.createRecord(webhookUrl, {
      所属项目: 'GW-PM',
      功能: 'GW-PM 连接测试',
      描述: 'Webhook 格式验证 - add_records',
      岗位: '后端',
      优先级: 'P00',
      人天: 1,
      备注: 'buildValues 函数验证'
    });

    console.log(`✅ 写入成功，record_id: ${recordId || '(Webhook 未返回)'}`);
  } catch (error) {
    console.error(`❌ 写入失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
