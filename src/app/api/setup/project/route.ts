import { db } from '@/lib/db';
import { projects, type ProjectType } from '@/lib/schema';
import { createPmUser, ensureDefaultWorkspace } from '../_shared';

type CreateProjectPayload = {
  name?: string;
  type?: ProjectType;
  pm_name?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as CreateProjectPayload;
  if (!body.name || !body.type) {
    return Response.json({ error: '项目名称和项目类型必填' }, { status: 400 });
  }

  const workspace = await ensureDefaultWorkspace();
  const pm = body.pm_name?.trim() ? await createPmUser(workspace.id, body.pm_name.trim()) : null;

  const inserted = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: body.name.trim(),
      type: body.type,
      status: 'planning',
      pmId: pm?.id ?? null
    })
    .returning({ project_id: projects.id });

  return Response.json(inserted[0] ?? { project_id: null });
}
