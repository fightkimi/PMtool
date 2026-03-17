import { registry } from '@/adapters/registry';
import { TableInitializer } from '@/adapters/tencentdoc/TableInitializer';

export async function POST(request: Request) {
  const body = (await request.json()) as { root_id?: string; project_name?: string };
  if (!body.root_id || !body.project_name) {
    return Response.json({ error: 'root_id 和 project_name 必填' }, { status: 400 });
  }

  const initializer = new TableInitializer(registry.getDoc());
  const tableIds = await initializer.initProjectTables(body.root_id, body.project_name);
  return Response.json(tableIds);
}
