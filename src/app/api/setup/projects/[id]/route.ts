import { archiveWorkspaceProject, patchWorkspaceProject } from '@/app/api/setup/_dashboard';
import type { ProjectType, SelectProject } from '@/lib/schema';

type ProjectPatchPayload = Partial<{
  name: string;
  type: ProjectType;
  status: SelectProject['status'];
  groupId: string | null;
  mgmtGroupId: string | null;
  tableRootId: string | null;
  taskTableWebhook: string | null;
  taskTableSchema: Record<string, string> | string | null;
  pipelineTableWebhook: string | null;
  pipelineTableSchema: Record<string, string> | string | null;
  capacityTableWebhook: string | null;
  capacityTableSchema: Record<string, string> | string | null;
  riskTableWebhook: string | null;
  riskTableSchema: Record<string, string> | string | null;
  changeTableWebhook: string | null;
  changeTableSchema: Record<string, string> | string | null;
}>;

function normalizeSchema(value: Record<string, string> | string | null | undefined): Record<string, string> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '{}') return {};
    return JSON.parse(trimmed) as Record<string, string>;
  }
  return value;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const params = await context.params;
    const body = (await request.json()) as ProjectPatchPayload;
    const updated = await patchWorkspaceProject(params.id, {
      ...body,
      taskTableSchema: normalizeSchema(body.taskTableSchema),
      pipelineTableSchema: normalizeSchema(body.pipelineTableSchema),
      capacityTableSchema: normalizeSchema(body.capacityTableSchema),
      riskTableSchema: normalizeSchema(body.riskTableSchema),
      changeTableSchema: normalizeSchema(body.changeTableSchema),
    });
    if (!updated) {
      return Response.json({ error: '项目不存在' }, { status: 404 });
    }

    return Response.json({ success: true, project: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败';
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const params = await context.params;
  await archiveWorkspaceProject(params.id);
  return Response.json({ success: true });
}
