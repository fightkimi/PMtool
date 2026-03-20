import { eq } from 'drizzle-orm';
import { registry } from '@/adapters/registry';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';
import { db } from '@/lib/db';
import { projects, type SelectProject } from '@/lib/schema';

type TestWecomPayload = {
  projectId?: string;
};

type TestWecomDeps = {
  ensureRegistryConfig?: () => Promise<void>;
  ensureWorkspace?: typeof ensureDefaultWorkspace;
  listProjects?: (workspaceId: string, projectId?: string) => Promise<SelectProject[]>;
  getIM?: typeof registry.getIM;
  now?: () => Date;
};

async function defaultListProjects(workspaceId: string, projectId?: string) {
  return projectId
    ? db.select().from(projects).where(eq(projects.id, projectId))
    : db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
}

export function createSetupWecomTestHandler(deps: TestWecomDeps = {}) {
  const ensureRegistryConfigFn = deps.ensureRegistryConfig ?? (() => registry.ensureDbConfig());
  const ensureWorkspaceFn = deps.ensureWorkspace ?? ensureDefaultWorkspace;
  const listProjectsFn = deps.listProjects ?? defaultListProjects;
  const getIMFn = deps.getIM ?? (() => registry.getIM());
  const nowFn = deps.now ?? (() => new Date());

  return async function POST(request: Request) {
    const body = (await request.json().catch(() => ({}))) as TestWecomPayload;
    await ensureRegistryConfigFn();
    const workspace = await ensureWorkspaceFn();

    const rows = await listProjectsFn(workspace.id, body.projectId);
    const project = rows.find((item) => item.wecomGroupId) ?? null;
    if (!project?.wecomGroupId) {
      return Response.json({ success: false, error: '没有找到已配置群 ID 的项目' }, { status: 400 });
    }

    const im = getIMFn();
    const status = im.getConnectionStatus?.();
    if (status?.mode === 'bot' && !status.connected) {
      return Response.json(
        {
          success: false,
          latencyMs: 0,
          error: status.detail ?? 'BOT WebSocket 当前未连接，请确认 worker 进程正在运行'
        },
        { status: 200 }
      );
    }

    const startedAt = nowFn().getTime();
    try {
      await im.sendMarkdown(
        project.wecomGroupId,
        `GW-PM BOT 连通性测试\n\n项目：${project.name}\n时间：${nowFn().toLocaleString('zh-CN')}`
      );
      return Response.json({ success: true, latencyMs: nowFn().getTime() - startedAt });
    } catch (error) {
      return Response.json(
        {
          success: false,
          latencyMs: nowFn().getTime() - startedAt,
          error: error instanceof Error ? error.message : '发送失败'
        },
        { status: 200 }
      );
    }
  };
}

export const POST = createSetupWecomTestHandler();
