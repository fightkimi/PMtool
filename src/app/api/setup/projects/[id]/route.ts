import { archiveWorkspaceProject, patchWorkspaceProject, validateProjectWebhookSchemas } from '@/app/api/setup/_dashboard';
import type { ProjectType, SelectProject } from '@/lib/schema';

type ProjectPatchPayload = Partial<{
  name: string;
  type: ProjectType;
  status: SelectProject['status'];
  groupId: string | null;
  mgmtGroupId: string | null;
  tableRootId: string | null;
  taskTableWebhook: string | null;
  taskTableSchema: Record<string, string> | null;
  pipelineTableWebhook: string | null;
  pipelineTableSchema: Record<string, string> | null;
  capacityTableWebhook: string | null;
  capacityTableSchema: Record<string, string> | null;
  riskTableWebhook: string | null;
  riskTableSchema: Record<string, string> | null;
  changeTableWebhook: string | null;
  changeTableSchema: Record<string, string> | null;
}>;

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  const body = (await request.json()) as ProjectPatchPayload;
  const validationError = validateProjectWebhookSchemas(body);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  const updated = await patchWorkspaceProject(context.params.id, body);
  if (!updated) {
    return Response.json({ error: '项目不存在' }, { status: 404 });
  }

  return Response.json({ success: true, project: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: { id: string } }
) {
  await archiveWorkspaceProject(context.params.id);
  return Response.json({ success: true });
}
