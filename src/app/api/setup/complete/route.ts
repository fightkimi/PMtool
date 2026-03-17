import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';

type CompletePayload = {
  project_id?: string;
  wecom_group_id?: string;
  wecom_bot_webhook?: string;
  wecom_mgmt_group_id?: string;
  smart_table_root_id?: string;
  task_table_id?: string;
  pipeline_table_id?: string;
  capacity_table_id?: string;
  risk_table_id?: string;
  change_table_id?: string;
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
      taskTableId: body.task_table_id ?? null,
      pipelineTableId: body.pipeline_table_id ?? null,
      capacityTableId: body.capacity_table_id ?? null,
      riskTableId: body.risk_table_id ?? null,
      changeTableId: body.change_table_id ?? null,
      updatedAt: new Date()
    })
    .where(eq(projects.id, body.project_id));

  return Response.json({ success: true });
}
