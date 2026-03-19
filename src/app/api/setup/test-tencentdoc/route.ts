import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';

export async function POST() {
  const workspace = await ensureDefaultWorkspace();
  const rows = await db.select().from(projects).where(eq(projects.workspaceId, workspace.id));

  const project = rows.find(
    (item) =>
      item.taskTableWebhook ||
      item.pipelineTableWebhook ||
      item.capacityTableWebhook ||
      item.riskTableWebhook ||
      item.changeTableWebhook
  );

  if (!project) {
    return Response.json({ success: false, error: '未配置任何腾讯智能表格 Webhook 地址' }, { status: 400 });
  }

  return Response.json({ success: true });
}
