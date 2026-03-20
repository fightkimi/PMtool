import { eq } from 'drizzle-orm';
import { registry } from '@/adapters/registry';
import type { DocRecord } from '@/adapters/types';
import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';
import { db } from '@/lib/db';
import { projects, type SelectProject } from '@/lib/schema';

type TestPayload = {
  projectId?: string;
};

type TableTarget = {
  label: string;
  webhookUrl: string;
  schema: Record<string, string>;
  fields: DocRecord;
};

type TencentDocTestDeps = {
  ensureWorkspace?: typeof ensureDefaultWorkspace;
  listProjects?: (workspaceId: string, projectId?: string) => Promise<SelectProject[]>;
  getDocAdapter?: () => ReturnType<typeof registry.getDoc>;
  now?: () => Date;
};

function hasSchema(schema: Record<string, string> | null | undefined): schema is Record<string, string> {
  return Boolean(schema && Object.keys(schema).length > 0);
}

function pickTableTarget(project: SelectProject, now: Date): TableTarget | null {
  const dateLabel = now.toISOString().slice(0, 10);
  const candidates: Array<TableTarget | null> = [
    project.taskTableWebhook
      ? {
          label: '任务表',
          webhookUrl: project.taskTableWebhook,
          schema: project.taskTableSchema ?? {},
          fields: {
            任务名: `[GW-PM] 连通性测试 ${dateLabel}`,
            状态: '测试',
            工种: 'system',
            估算工时: 1,
            优先级: 'low'
          }
        }
      : null,
    project.pipelineTableWebhook
      ? {
          label: '排期表',
          webhookUrl: project.pipelineTableWebhook,
          schema: project.pipelineTableSchema ?? {},
          fields: {
            Run名: '[GW-PM] 连通性测试',
            阶段编号: 'connectivity-check',
            工种: 'system',
            状态: 'testing'
          }
        }
      : null,
    project.riskTableWebhook
      ? {
          label: '风险表',
          webhookUrl: project.riskTableWebhook,
          schema: project.riskTableSchema ?? {},
          fields: {
            风险描述: `[GW-PM] 连通性测试 ${dateLabel}`,
            等级: 'low',
            状态: 'open',
            处理人: 'system'
          }
        }
      : null,
    project.capacityTableWebhook
      ? {
          label: '产能表',
          webhookUrl: project.capacityTableWebhook,
          schema: project.capacityTableSchema ?? {},
          fields: {
            成员: 'GW-PM',
            工种: 'system',
            周期: dateLabel,
            可用工时: 1,
            已分配: 0,
            负载率: 0
          }
        }
      : null
  ];

  return candidates.find((item): item is TableTarget => Boolean(item)) ?? null;
}

async function defaultListProjects(workspaceId: string, projectId?: string): Promise<SelectProject[]> {
  return projectId
    ? db.select().from(projects).where(eq(projects.id, projectId))
    : db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
}

export function createSetupTencentDocTestHandler(deps: TencentDocTestDeps = {}) {
  const ensureWorkspaceFn = deps.ensureWorkspace ?? ensureDefaultWorkspace;
  const listProjectsFn = deps.listProjects ?? defaultListProjects;
  const getDocAdapterFn = deps.getDocAdapter ?? (() => registry.getDoc());
  const nowFn = deps.now ?? (() => new Date());

  return async function POST(request: Request) {
    const body = (await request.json().catch(() => ({}))) as TestPayload;
    const workspace = await ensureWorkspaceFn();
    const rows = await listProjectsFn(workspace.id, body.projectId);

    const project = rows.find((item) => pickTableTarget(item, nowFn())) ?? null;
    if (!project) {
      return Response.json({ success: false, error: '未找到已配置腾讯智能表格 Webhook 的项目' }, { status: 400 });
    }

    const target = pickTableTarget(project, nowFn());
    if (!target) {
      return Response.json({ success: false, error: '项目未配置可测试的腾讯智能表格' }, { status: 400 });
    }

    if (!hasSchema(target.schema)) {
      return Response.json(
        {
          success: false,
          error: `${project.name} 的${target.label}缺少字段映射 schema，暂时无法执行真实写入测试`
        },
        { status: 400 }
      );
    }

    const baseAdapter = getDocAdapterFn();
    const projectAdapter =
      baseAdapter instanceof TencentDocAdapter ? baseAdapter.withWebhookSchema(target.webhookUrl, target.schema) : baseAdapter;

    const startedAt = Date.now();
    try {
      const recordId = await projectAdapter.createRecord(target.webhookUrl, target.fields);
      return Response.json({
        success: true,
        latencyMs: Date.now() - startedAt,
        projectName: project.name,
        tableType: target.label,
        recordId: recordId || null
      });
    } catch (error) {
      return Response.json(
        {
          success: false,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : '腾讯智能表格写入失败'
        },
        { status: 200 }
      );
    }
  }
}

export const POST = createSetupTencentDocTestHandler();
