import { getWorkspaceById, loadSetupStatus, updateWorkspaceName } from '@/app/api/setup/_dashboard';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';

type StatusDeps = {
  loadStatus?: () => Promise<Awaited<ReturnType<typeof loadSetupStatus>>>;
  ensureWorkspace?: typeof ensureDefaultWorkspace;
  updateWorkspaceName?: typeof updateWorkspaceName;
  getWorkspaceById?: typeof getWorkspaceById;
};

export function createSetupStatusHandlers(deps: StatusDeps = {}) {
  const loadStatusFn = deps.loadStatus ?? (() => loadSetupStatus());
  const ensureWorkspaceFn = deps.ensureWorkspace ?? ensureDefaultWorkspace;
  const updateWorkspaceNameFn = deps.updateWorkspaceName ?? updateWorkspaceName;
  const getWorkspaceByIdFn = deps.getWorkspaceById ?? getWorkspaceById;

  return {
    async GET() {
      return Response.json(await loadStatusFn());
    },

    async PATCH(request: Request) {
      const body = (await request.json()) as { name?: string };
      if (!body.name?.trim()) {
        return Response.json({ error: '企业名称必填' }, { status: 400 });
      }

      const workspace = await ensureWorkspaceFn();
      await updateWorkspaceNameFn(workspace.id, body.name);
      const updated = await getWorkspaceByIdFn(workspace.id);

      return Response.json({
        workspace: {
          id: updated?.id ?? workspace.id,
          name: updated?.name ?? body.name.trim()
        }
      });
    }
  };
}
