import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, type InsertProject, type ProjectType, type SelectProject, type SelectWorkspace, workspaces } from '@/lib/schema';
import { ensureDefaultWorkspace } from './_shared';

export type SetupStatusProject = {
  id: string;
  name: string;
  type: ProjectType;
  status: SelectProject['status'];
  groupId: string | null;
  mgmtGroupId: string | null;
  tableRootId: string | null;
  taskTableWebhook: string | null;
  taskTableSchema: Record<string, string>;
  pipelineTableWebhook: string | null;
  pipelineTableSchema: Record<string, string>;
  capacityTableWebhook: string | null;
  capacityTableSchema: Record<string, string>;
  riskTableWebhook: string | null;
  riskTableSchema: Record<string, string>;
  changeTableWebhook: string | null;
  changeTableSchema: Record<string, string>;
  tables: {
    task: boolean;
    pipeline: boolean;
    capacity: boolean;
    risk: boolean;
  };
};

export type SetupStatusResponse = {
  workspace: { id: string; name: string };
  bot: { configured: boolean; botIdPreview: string | null; connected: boolean };
  ai: {
    defaultModel: string;
    providers: {
      doubao: boolean;
      minimax: boolean;
      zhipu: boolean;
      deepseek: boolean;
      claude: boolean;
    };
  };
  tencentdoc: { configured: boolean; appIdPreview: string | null };
  projects: SetupStatusProject[];
};

export type SetupProjectCreateInput = {
  name: string;
  type: ProjectType;
  groupId?: string | null;
  tableRootId?: string | null;
};

export function previewSecret(value: string | null | undefined, visible = 8): string | null {
  if (!value) {
    return null;
  }

  return `${value.slice(0, visible)}***`;
}

export function mapProjectToSetupSummary(project: SelectProject): SetupStatusProject {
  return {
    id: project.id,
    name: project.name,
    type: project.type,
    status: project.status,
    groupId: project.wecomGroupId ?? null,
    mgmtGroupId: project.wecomMgmtGroupId ?? null,
    tableRootId: project.smartTableRootId ?? null,
    taskTableWebhook: project.taskTableWebhook ?? null,
    taskTableSchema: project.taskTableSchema ?? {},
    pipelineTableWebhook: project.pipelineTableWebhook ?? null,
    pipelineTableSchema: project.pipelineTableSchema ?? {},
    capacityTableWebhook: project.capacityTableWebhook ?? null,
    capacityTableSchema: project.capacityTableSchema ?? {},
    riskTableWebhook: project.riskTableWebhook ?? null,
    riskTableSchema: project.riskTableSchema ?? {},
    changeTableWebhook: project.changeTableWebhook ?? null,
    changeTableSchema: project.changeTableSchema ?? {},
    tables: {
      task: Boolean(project.taskTableWebhook),
      pipeline: Boolean(project.pipelineTableWebhook),
      capacity: Boolean(project.capacityTableWebhook),
      risk: Boolean(project.riskTableWebhook)
    }
  };
}

export function buildProviderStatus(env: NodeJS.ProcessEnv = process.env) {
  return {
    doubao: Boolean(env.ARK_API_KEY),
    minimax: Boolean(env.MINIMAX_API_KEY),
    zhipu: Boolean(env.ZHIPU_API_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY),
    claude: Boolean(env.ANTHROPIC_API_KEY)
  };
}

export async function listWorkspaceProjects(workspaceId: string): Promise<SelectProject[]> {
  return db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
}

export async function getWorkspaceById(workspaceId: string): Promise<SelectWorkspace | null> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return rows[0] ?? null;
}

export async function updateWorkspaceName(workspaceId: string, name: string): Promise<void> {
  await db.update(workspaces).set({ name: name.trim(), updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
}

export async function createWorkspaceProject(
  workspaceId: string,
  input: SetupProjectCreateInput
): Promise<SelectProject> {
  const inserted = await db
    .insert(projects)
    .values({
      workspaceId,
      name: input.name.trim(),
      type: input.type,
      status: 'planning',
      wecomGroupId: input.groupId?.trim() || null,
      smartTableRootId: input.tableRootId?.trim() || null
    } satisfies InsertProject)
    .returning();

  return inserted[0]!;
}

export async function patchWorkspaceProject(
  projectId: string,
  input: Partial<{
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
  }>
): Promise<SelectProject | null> {
  const update = {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.groupId !== undefined ? { wecomGroupId: input.groupId?.trim() || null } : {}),
    ...(input.mgmtGroupId !== undefined ? { wecomMgmtGroupId: input.mgmtGroupId?.trim() || null } : {}),
    ...(input.tableRootId !== undefined ? { smartTableRootId: input.tableRootId?.trim() || null } : {}),
    ...(input.taskTableWebhook !== undefined ? { taskTableWebhook: input.taskTableWebhook?.trim() || null } : {}),
    ...(input.taskTableSchema !== undefined ? { taskTableSchema: input.taskTableSchema ?? {} } : {}),
    ...(input.pipelineTableWebhook !== undefined ? { pipelineTableWebhook: input.pipelineTableWebhook?.trim() || null } : {}),
    ...(input.pipelineTableSchema !== undefined ? { pipelineTableSchema: input.pipelineTableSchema ?? {} } : {}),
    ...(input.capacityTableWebhook !== undefined ? { capacityTableWebhook: input.capacityTableWebhook?.trim() || null } : {}),
    ...(input.capacityTableSchema !== undefined ? { capacityTableSchema: input.capacityTableSchema ?? {} } : {}),
    ...(input.riskTableWebhook !== undefined ? { riskTableWebhook: input.riskTableWebhook?.trim() || null } : {}),
    ...(input.riskTableSchema !== undefined ? { riskTableSchema: input.riskTableSchema ?? {} } : {}),
    ...(input.changeTableWebhook !== undefined ? { changeTableWebhook: input.changeTableWebhook?.trim() || null } : {}),
    ...(input.changeTableSchema !== undefined ? { changeTableSchema: input.changeTableSchema ?? {} } : {}),
    updatedAt: new Date()
  } as Partial<InsertProject>;

  const rows = await db.update(projects).set(update).where(eq(projects.id, projectId)).returning();
  return rows[0] ?? null;
}

export async function archiveWorkspaceProject(projectId: string): Promise<void> {
  await db.update(projects).set({ status: 'archived', updatedAt: new Date() }).where(eq(projects.id, projectId));
}

export async function buildSetupStatus(
  workspace: SelectWorkspace,
  projectRows: SelectProject[],
  env: NodeJS.ProcessEnv = process.env
): Promise<SetupStatusResponse> {
  const botConfigured = Boolean(env.WECOM_BOT_ID && env.WECOM_BOT_SECRET);
  const tencentConfigured = projectRows.some(
    (project) =>
      Boolean(project.taskTableWebhook) ||
      Boolean(project.pipelineTableWebhook) ||
      Boolean(project.capacityTableWebhook) ||
      Boolean(project.riskTableWebhook) ||
      Boolean(project.changeTableWebhook)
  );

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name
    },
    bot: {
      configured: botConfigured,
      botIdPreview: previewSecret(env.WECOM_BOT_ID),
      connected: botConfigured
    },
    ai: {
      defaultModel: env.DEFAULT_AI_MODEL ?? 'claude',
      providers: buildProviderStatus(env)
    },
    tencentdoc: {
      configured: tencentConfigured,
      appIdPreview: tencentConfigured ? 'Webhook 模式' : null
    },
    projects: projectRows.map(mapProjectToSetupSummary)
  };
}

export async function loadSetupStatus(env: NodeJS.ProcessEnv = process.env): Promise<SetupStatusResponse> {
  const workspace = await ensureDefaultWorkspace();
  const projectRows = await listWorkspaceProjects(workspace.id);
  return buildSetupStatus(workspace, projectRows, env);
}
