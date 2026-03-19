import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';

type CompletePayload = {
  project_id?: string;
  wecom_group_id?: string;
  wecom_bot_webhook?: string;
  wecom_mgmt_group_id?: string;
  smart_table_root_id?: string;
  task_table_webhook?: string;
  pipeline_table_webhook?: string;
  capacity_table_webhook?: string;
  risk_table_webhook?: string;
  change_table_webhook?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as CompletePayload;
  if (!body.project_id) {
    return Response.json({ error: 'project_id 必填' }, { status: 400 });
  }

  await db
    .update(projects)
    .set({
      wecomGroupId: body.wecom_group_id ?? null,
      wecomBotWebhook: body.wecom_bot_webhook ?? null,
      wecomMgmtGroupId: body.wecom_mgmt_group_id ?? null,
      smartTableRootId: body.smart_table_root_id ?? null,
      taskTableWebhook: body.task_table_webhook ?? null,
      pipelineTableWebhook: body.pipeline_table_webhook ?? null,
      capacityTableWebhook: body.capacity_table_webhook ?? null,
      riskTableWebhook: body.risk_table_webhook ?? null,
      changeTableWebhook: body.change_table_webhook ?? null,
      updatedAt: new Date()
    })
    .where(eq(projects.id, body.project_id));

  return Response.json({ success: true });
}
