import { eq, isNotNull } from 'drizzle-orm';
import { registry } from '@/adapters/registry';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { projectId?: string };
  const workspace = await ensureDefaultWorkspace();

  const rows = body.projectId
    ? await db.select().from(projects).where(eq(projects.id, body.projectId))
    : await db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, workspace.id));

  const project = rows.find((item) => item.wecomGroupId) ?? null;
  if (!project?.wecomGroupId) {
    return Response.json({ success: false, error: '没有找到已配置群 ID 的项目' }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    await registry
      .getIM()
      .sendMarkdown(project.wecomGroupId, `GW-PM BOT 连通性测试\n\n项目：${project.name}\n时间：${new Date().toLocaleString('zh-CN')}`);
    return Response.json({ success: true, latencyMs: Date.now() - startedAt });
  } catch (error) {
    return Response.json(
      {
        success: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : '发送失败'
      },
      { status: 200 }
    );
  }
}
