import {
  createWorkspaceProject,
  listWorkspaceProjects,
  mapProjectToSetupSummary,
  type SetupProjectCreateInput
} from '@/app/api/setup/_dashboard';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';
import { projectTypeValues, type ProjectType } from '@/lib/schema';

type ProjectsDeps = {
  ensureWorkspace?: typeof ensureDefaultWorkspace;
  listProjects?: typeof listWorkspaceProjects;
  createProject?: typeof createWorkspaceProject;
};

function isProjectType(value: string): value is ProjectType {
  return projectTypeValues.includes(value as ProjectType);
}

export function createSetupProjectsHandlers(deps: ProjectsDeps = {}) {
  const ensureWorkspaceFn = deps.ensureWorkspace ?? ensureDefaultWorkspace;
  const listProjectsFn = deps.listProjects ?? listWorkspaceProjects;
  const createProjectFn = deps.createProject ?? createWorkspaceProject;

  return {
    async GET() {
      const workspace = await ensureWorkspaceFn();
      const rows = await listProjectsFn(workspace.id);
      return Response.json(rows.map((project) => mapProjectToSetupSummary(project)));
    },

    async POST(request: Request) {
      const body = (await request.json()) as SetupProjectCreateInput;
      if (!body.name?.trim()) {
        return Response.json({ error: '项目名称必填' }, { status: 400 });
      }
      if (!body.type || !isProjectType(body.type)) {
        return Response.json({ error: '项目类型不合法' }, { status: 400 });
      }

      const workspace = await ensureWorkspaceFn();
      const inserted = await createProjectFn(workspace.id, body);
      return Response.json(mapProjectToSetupSummary(inserted), { status: 201 });
    }
  };
}

const handlers = createSetupProjectsHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
