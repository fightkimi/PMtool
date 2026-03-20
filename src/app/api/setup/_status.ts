import { getWorkspaceById, loadSetupStatus, updateWorkspaceAdapterConfig, updateWorkspaceName } from '@/app/api/setup/_dashboard';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';
import { registry } from '@/adapters/registry';
import type { WorkspaceAdapterConfig } from '@/types/adapter-config';

type StatusDeps = {
  loadStatus?: () => Promise<Awaited<ReturnType<typeof loadSetupStatus>>>;
  ensureWorkspace?: typeof ensureDefaultWorkspace;
  updateWorkspaceName?: typeof updateWorkspaceName;
  updateAdapterConfig?: typeof updateWorkspaceAdapterConfig;
  getWorkspaceById?: typeof getWorkspaceById;
  reloadRegistry?: (config: WorkspaceAdapterConfig) => void;
};

export function createSetupStatusHandlers(deps: StatusDeps = {}) {
  const loadStatusFn = deps.loadStatus ?? (() => loadSetupStatus());
  const ensureWorkspaceFn = deps.ensureWorkspace ?? ensureDefaultWorkspace;
  const updateWorkspaceNameFn = deps.updateWorkspaceName ?? updateWorkspaceName;
  const updateAdapterConfigFn = deps.updateAdapterConfig ?? updateWorkspaceAdapterConfig;
  const getWorkspaceByIdFn = deps.getWorkspaceById ?? getWorkspaceById;
  const reloadRegistryFn = deps.reloadRegistry ?? ((config: WorkspaceAdapterConfig) => registry.reloadFromConfig(config));

  return {
    async GET() {
      return Response.json(await loadStatusFn());
    },

    async PATCH(request: Request) {
      const body = (await request.json()) as {
        name?: string;
        adapterConfig?: WorkspaceAdapterConfig;
      };

      const hasName = Boolean(body.name?.trim());
      const hasConfig = Boolean(body.adapterConfig);

      // 先校验，再执行副作用
      if (!hasName && !hasConfig) {
        return Response.json({ error: '请提供企业名称或适配器配置' }, { status: 400 });
      }

      const workspace = await ensureWorkspaceFn();

      // 并行执行独立的 DB 写操作
      const writes: Promise<void>[] = [];
      if (hasName) {
        writes.push(updateWorkspaceNameFn(workspace.id, body.name!));
      }
      if (hasConfig) {
        writes.push(updateAdapterConfigFn(workspace.id, body.adapterConfig!));
      }
      await Promise.all(writes);

      if (hasConfig) {
        reloadRegistryFn(body.adapterConfig!);
      }

      const updated = await getWorkspaceByIdFn(workspace.id);

      return Response.json({
        workspace: {
          id: updated?.id ?? workspace.id,
          name: updated?.name ?? body.name?.trim() ?? workspace.name
        }
      });
    }
  };
}
