import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  capacitySnapshots,
  changeRequests,
  pipelineRuns,
  pipelineStageInstances,
  projects,
  risks,
  tasks,
  weeklyReports,
  type InsertProject,
  type ProjectType,
  type SelectProject,
  type SelectWorkspace,
  workspaces
} from '@/lib/schema';
import type { WorkspaceAdapterConfig } from '@/types/adapter-config';
import { ensureDefaultWorkspace } from './_shared';

type SetupTableHealthKey = 'task' | 'pipeline' | 'capacity' | 'risk' | 'change';

export type SetupProjectTableHealth = {
  key: SetupTableHealthKey;
  label: string;
  state: 'missing' | 'needs_schema' | 'ready' | 'synced';
  webhookConfigured: boolean;
  schemaConfigured: boolean;
  lastSyncedAt: string | null;
  recordCount: number;
};

export type SetupProjectRecentSync = {
  key: SetupTableHealthKey;
  label: string;
  syncedAt: string;
  summary: string;
};

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
  tableHealth: SetupProjectTableHealth[];
  recentSyncs: SetupProjectRecentSync[];
  healthSummary: {
    readyTables: number;
    syncedTables: number;
    attentionTables: number;
  };
  pmSummary: SetupProjectPmSummary;
};

export type SetupStatusResponse = {
  workspace: { id: string; name: string };
  adapterConfig: WorkspaceAdapterConfig;
  bot: { configured: boolean; botId: string | null; connected: boolean };
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

const projectTableSchemaLabels = [
  ['taskTableWebhook', 'taskTableSchema', '任务表'],
  ['pipelineTableWebhook', 'pipelineTableSchema', '管线排期表'],
  ['capacityTableWebhook', 'capacityTableSchema', '产能表'],
  ['riskTableWebhook', 'riskTableSchema', '风险表'],
  ['changeTableWebhook', 'changeTableSchema', '变更表']
] as const;

const tableHealthMeta: Record<SetupTableHealthKey, { label: string; webhookField: keyof SelectProject; schemaField: keyof SelectProject }> = {
  task: { label: '任务表', webhookField: 'taskTableWebhook', schemaField: 'taskTableSchema' },
  pipeline: { label: '排期表', webhookField: 'pipelineTableWebhook', schemaField: 'pipelineTableSchema' },
  capacity: { label: '产能表', webhookField: 'capacityTableWebhook', schemaField: 'capacityTableSchema' },
  risk: { label: '风险表', webhookField: 'riskTableWebhook', schemaField: 'riskTableSchema' },
  change: { label: '变更表', webhookField: 'changeTableWebhook', schemaField: 'changeTableSchema' }
};

type TableSyncEvidence = {
  lastSyncedAt: Date | null;
  recordCount: number;
};

type ProjectSyncEvidence = Record<SetupTableHealthKey, TableSyncEvidence>;
type ProjectSyncInsights = {
  evidence: ProjectSyncEvidence;
  recentSyncs: SetupProjectRecentSync[];
};

type ProjectPmSignalCounts = {
  blockedTaskCount: number;
  blockedStageCount: number;
  overdueTaskCount: number;
  dueSoonTaskCount: number;
  openRiskCount: number;
  criticalRiskCount: number;
  milestoneRiskCount: number;
  activeChangeCount: number;
  lastWeeklyReportAt: Date | null;
};

export type SetupProjectPmSummary = {
  blockedCount: number;
  overdueCount: number;
  dueSoonCount: number;
  openRiskCount: number;
  criticalRiskCount: number;
  milestoneRiskCount: number;
  activeChangeCount: number;
  lastWeeklyReportAt: string | null;
  weeklyReportStatus: 'fresh' | 'stale' | 'missing';
  attentionLevel: 'high' | 'medium' | 'low';
  highlights: string[];
};

function createEmptyProjectSyncEvidence(): ProjectSyncEvidence {
  return {
    task: { lastSyncedAt: null, recordCount: 0 },
    pipeline: { lastSyncedAt: null, recordCount: 0 },
    capacity: { lastSyncedAt: null, recordCount: 0 },
    risk: { lastSyncedAt: null, recordCount: 0 },
    change: { lastSyncedAt: null, recordCount: 0 }
  };
}

function createEmptyProjectPmSignalCounts(): ProjectPmSignalCounts {
  return {
    blockedTaskCount: 0,
    blockedStageCount: 0,
    overdueTaskCount: 0,
    dueSoonTaskCount: 0,
    openRiskCount: 0,
    criticalRiskCount: 0,
    milestoneRiskCount: 0,
    activeChangeCount: 0,
    lastWeeklyReportAt: null
  };
}

export function buildProjectPmSummary(
  counts: ProjectPmSignalCounts = createEmptyProjectPmSignalCounts(),
  now: Date = new Date()
): SetupProjectPmSummary {
  const blockedCount = counts.blockedTaskCount + counts.blockedStageCount;
  const weeklyReportStatus: SetupProjectPmSummary['weeklyReportStatus'] = !counts.lastWeeklyReportAt
    ? 'missing'
    : now.getTime() - counts.lastWeeklyReportAt.getTime() > 8 * 86400000
      ? 'stale'
      : 'fresh';

  let attentionLevel: SetupProjectPmSummary['attentionLevel'] = 'low';
  if (blockedCount > 0 || counts.overdueTaskCount > 0 || counts.criticalRiskCount > 0 || counts.milestoneRiskCount > 0) {
    attentionLevel = 'high';
  } else if (
    counts.dueSoonTaskCount > 0 ||
    counts.openRiskCount > 0 ||
    counts.activeChangeCount > 0 ||
    weeklyReportStatus !== 'fresh'
  ) {
    attentionLevel = 'medium';
  }

  const highlights: string[] = [];
  if (blockedCount > 0) {
    highlights.push(`阻塞 ${blockedCount} 项，建议先确认责任人与恢复时间`);
  }
  if (counts.overdueTaskCount > 0) {
    highlights.push(`逾期 ${counts.overdueTaskCount} 项，需要重新校准交付承诺`);
  }
  if (counts.milestoneRiskCount > 0) {
    highlights.push(`里程碑风险 ${counts.milestoneRiskCount} 项，建议提前同步偏差`);
  } else if (counts.criticalRiskCount > 0) {
    highlights.push(`高风险 ${counts.criticalRiskCount} 项，建议尽快收敛处理方案`);
  }
  if (counts.activeChangeCount > 0) {
    highlights.push(`变更请求 ${counts.activeChangeCount} 项处理中，需关注影响范围`);
  }
  if (weeklyReportStatus === 'missing') {
    highlights.push('本周暂无周报记录，建议补一次阶段总结');
  } else if (weeklyReportStatus === 'stale') {
    highlights.push('周报超过 7 天未更新，建议同步最新里程碑进度');
  } else if (counts.dueSoonTaskCount > 0) {
    highlights.push(`近 3 天有 ${counts.dueSoonTaskCount} 项任务即将到期`);
  }

  return {
    blockedCount,
    overdueCount: counts.overdueTaskCount,
    dueSoonCount: counts.dueSoonTaskCount,
    openRiskCount: counts.openRiskCount,
    criticalRiskCount: counts.criticalRiskCount,
    milestoneRiskCount: counts.milestoneRiskCount,
    activeChangeCount: counts.activeChangeCount,
    lastWeeklyReportAt: toIsoOrNull(counts.lastWeeklyReportAt),
    weeklyReportStatus,
    attentionLevel,
    highlights: highlights.slice(0, 3)
  };
}

export function previewSecret(value: string | null | undefined, visible = 8): string | null {
  if (!value) {
    return null;
  }

  return `${value.slice(0, visible)}***`;
}

export function validateProjectWebhookSchemas(
  input: Partial<{
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
): string | null {
  for (const [webhookField, schemaField, label] of projectTableSchemaLabels) {
    const webhook = input[webhookField];
    const schema = input[schemaField];
    if (typeof webhook === 'string' && webhook.trim() && (!schema || Object.keys(schema).length === 0)) {
      return `${label}已配置 Webhook，但缺少字段映射 schema。请粘贴 Webhook 示例 JSON 或 {"字段ID":"列名"} 映射。`;
    }
  }

  return null;
}

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildProjectTableHealth(
  project: SelectProject,
  evidence: ProjectSyncEvidence = createEmptyProjectSyncEvidence()
): SetupStatusProject['tableHealth'] {
  return (Object.keys(tableHealthMeta) as SetupTableHealthKey[]).map((key) => {
    const meta = tableHealthMeta[key];
    const webhookConfigured = Boolean(project[meta.webhookField]);
    const schemaValue = project[meta.schemaField];
    const schemaConfigured = typeof schemaValue === 'object' && schemaValue !== null && Object.keys(schemaValue).length > 0;
    const syncEvidence = evidence[key];

    let state: SetupProjectTableHealth['state'] = 'missing';
    if (syncEvidence.recordCount > 0) {
      state = 'synced';
    } else if (webhookConfigured && schemaConfigured) {
      state = 'ready';
    } else if (webhookConfigured) {
      state = 'needs_schema';
    }

    return {
      key,
      label: meta.label,
      state,
      webhookConfigured,
      schemaConfigured,
      lastSyncedAt: toIsoOrNull(syncEvidence.lastSyncedAt),
      recordCount: syncEvidence.recordCount
    };
  });
}

function buildProjectHealthSummary(tableHealth: SetupStatusProject['tableHealth']): SetupStatusProject['healthSummary'] {
  return {
    readyTables: tableHealth.filter((item) => item.state === 'ready' || item.state === 'synced').length,
    syncedTables: tableHealth.filter((item) => item.state === 'synced').length,
    attentionTables: tableHealth.filter((item) => item.state === 'needs_schema').length
  };
}

export function mapProjectToSetupSummary(
  project: SelectProject,
  evidence: ProjectSyncEvidence = createEmptyProjectSyncEvidence(),
  recentSyncs: SetupProjectRecentSync[] = [],
  pmSummary: SetupProjectPmSummary = buildProjectPmSummary()
): SetupStatusProject {
  const tableHealth = buildProjectTableHealth(project, evidence);
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
    },
    tableHealth,
    recentSyncs,
    healthSummary: buildProjectHealthSummary(tableHealth),
    pmSummary
  };
}

export function buildProviderStatus(env: NodeJS.ProcessEnv = process.env, dbAi?: WorkspaceAdapterConfig['ai']) {
  return {
    doubao: Boolean(dbAi?.arkApiKey || env.ARK_API_KEY),
    minimax: Boolean(dbAi?.minimaxApiKey || env.MINIMAX_API_KEY),
    zhipu: Boolean(dbAi?.zhipuApiKey || env.ZHIPU_API_KEY),
    deepseek: Boolean(dbAi?.deepseekApiKey || env.DEEPSEEK_API_KEY),
    claude: Boolean(dbAi?.anthropicApiKey || env.ANTHROPIC_API_KEY)
  };
}

export async function listWorkspaceProjects(workspaceId: string): Promise<SelectProject[]> {
  return db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
}

export async function getProjectSyncEvidenceMap(
  workspaceId: string,
  projectRows: SelectProject[]
): Promise<Record<string, ProjectSyncInsights>> {
  const projectIds = projectRows.map((project) => project.id);
  const insightsMap = Object.fromEntries(
    projectIds.map((projectId) => [
      projectId,
      {
        evidence: createEmptyProjectSyncEvidence(),
        recentSyncs: []
      }
    ])
  ) as Record<
    string,
    ProjectSyncInsights
  >;

  if (projectIds.length === 0) {
    return insightsMap;
  }

  const [taskRows, pipelineRows, riskRows, capacityRows] = await Promise.all([
    db
      .select({ projectId: tasks.projectId, updatedAt: tasks.updatedAt, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(and(inArray(tasks.projectId, projectIds), isNotNull(tasks.tableRecordId))),
    db
      .select({
        projectId: pipelineRuns.projectId,
        updatedAt: pipelineStageInstances.updatedAt,
        stageKey: pipelineStageInstances.stageKey,
        status: pipelineStageInstances.status
      })
      .from(pipelineStageInstances)
      .innerJoin(pipelineRuns, eq(pipelineStageInstances.runId, pipelineRuns.id))
      .where(and(inArray(pipelineRuns.projectId, projectIds), isNotNull(pipelineStageInstances.tableRecordId))),
    db
      .select({ projectId: risks.projectId, updatedAt: risks.lastSeenAt, description: risks.description, status: risks.status })
      .from(risks)
      .where(and(inArray(risks.projectId, projectIds), isNotNull(risks.tableRecordId))),
    db
      .select({
        createdAt: capacitySnapshots.createdAt,
        projectBreakdown: capacitySnapshots.projectBreakdown,
        roleType: capacitySnapshots.roleType,
        weekStart: capacitySnapshots.weekStart
      })
      .from(capacitySnapshots)
      .where(eq(capacitySnapshots.workspaceId, workspaceId))
  ]);

  const updateEvidence = (projectId: string, key: SetupTableHealthKey, timestamp: Date) => {
    const current = insightsMap[projectId]?.evidence[key];
    if (!current) {
      return;
    }

    current.recordCount += 1;
    if (!current.lastSyncedAt || current.lastSyncedAt < timestamp) {
      current.lastSyncedAt = timestamp;
    }
  };

  const recentSyncMap = new Map<string, SetupProjectRecentSync>();
  const updateRecentSync = (projectId: string, item: SetupProjectRecentSync) => {
    const current = recentSyncMap.get(`${projectId}:${item.key}`);
    if (!current || new Date(current.syncedAt).getTime() < new Date(item.syncedAt).getTime()) {
      recentSyncMap.set(`${projectId}:${item.key}`, item);
    }
  };

  for (const row of taskRows) {
    updateEvidence(row.projectId, 'task', row.updatedAt);
    updateRecentSync(row.projectId, {
      key: 'task',
      label: '任务表',
      syncedAt: row.updatedAt.toISOString(),
      summary: `${row.title} · ${row.status}`
    });
  }

  for (const row of pipelineRows) {
    updateEvidence(row.projectId, 'pipeline', row.updatedAt);
    updateRecentSync(row.projectId, {
      key: 'pipeline',
      label: '排期表',
      syncedAt: row.updatedAt.toISOString(),
      summary: `${row.stageKey} · ${row.status}`
    });
  }

  for (const row of riskRows) {
    updateEvidence(row.projectId, 'risk', row.updatedAt);
    updateRecentSync(row.projectId, {
      key: 'risk',
      label: '风险表',
      syncedAt: row.updatedAt.toISOString(),
      summary: `${row.description} · ${row.status}`
    });
  }

  const projectIdSet = new Set(projectIds);
  for (const row of capacityRows) {
    const breakdown = row.projectBreakdown ?? {};
    for (const projectId of Object.keys(breakdown)) {
      if (projectIdSet.has(projectId)) {
        updateEvidence(projectId, 'capacity', row.createdAt);
        updateRecentSync(projectId, {
          key: 'capacity',
          label: '产能表',
          syncedAt: row.createdAt.toISOString(),
          summary: `${row.roleType} · 周期 ${row.weekStart}`
        });
      }
    }
  }

  for (const projectId of projectIds) {
    insightsMap[projectId]!.recentSyncs = [...recentSyncMap.entries()]
      .filter(([compoundKey]) => compoundKey.startsWith(`${projectId}:`))
      .map(([, item]) => item)
      .sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime());
  }

  return insightsMap;
}

export async function getProjectPmSummaryMap(
  projectRows: SelectProject[],
  now: Date = new Date()
): Promise<Record<string, SetupProjectPmSummary>> {
  if (projectRows.length === 0) {
    return {};
  }

  const projectIds = projectRows.map((project) => project.id);
  const countsMap = Object.fromEntries(
    projectIds.map((projectId) => [projectId, createEmptyProjectPmSignalCounts()])
  ) as Record<string, ProjectPmSignalCounts>;
  const dueSoonCutoff = new Date(now.getTime() + 3 * 86400000);

  const taskRows = await db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      dueAt: tasks.dueAt
    })
    .from(tasks)
    .where(inArray(tasks.projectId, projectIds));

  for (const row of taskRows) {
    const counts = countsMap[row.projectId];
    if (!counts) {
      continue;
    }
    if (row.status === 'blocked') {
      counts.blockedTaskCount += 1;
    }
    if (!row.dueAt || row.status === 'done' || row.status === 'cancelled') {
      continue;
    }
    if (row.dueAt.getTime() < now.getTime()) {
      counts.overdueTaskCount += 1;
    } else if (row.dueAt.getTime() <= dueSoonCutoff.getTime()) {
      counts.dueSoonTaskCount += 1;
    }
  }

  const runRows = await db
    .select({
      id: pipelineRuns.id,
      projectId: pipelineRuns.projectId
    })
    .from(pipelineRuns)
    .where(inArray(pipelineRuns.projectId, projectIds));
  const runIdToProjectId = new Map(runRows.map((row) => [row.id, row.projectId]));
  if (runRows.length > 0) {
    const stageRows = await db
      .select({
        runId: pipelineStageInstances.runId,
        status: pipelineStageInstances.status
      })
      .from(pipelineStageInstances)
      .where(inArray(pipelineStageInstances.runId, runRows.map((row) => row.id)));

    for (const row of stageRows) {
      if (row.status !== 'blocked') {
        continue;
      }
      const projectId = runIdToProjectId.get(row.runId);
      if (projectId) {
        countsMap[projectId]!.blockedStageCount += 1;
      }
    }
  }

  const riskRows = await db
    .select({
      projectId: risks.projectId,
      status: risks.status,
      level: risks.level,
      description: risks.description
    })
    .from(risks)
    .where(inArray(risks.projectId, projectIds));

  for (const row of riskRows) {
    if (row.status === 'resolved') {
      continue;
    }
    const counts = countsMap[row.projectId];
    if (!counts) {
      continue;
    }
    counts.openRiskCount += 1;
    if (row.level === 'critical') {
      counts.criticalRiskCount += 1;
    }
    if (row.description.startsWith('里程碑风险：')) {
      counts.milestoneRiskCount += 1;
    }
  }

  const changeRows = await db
    .select({
      projectId: changeRequests.projectId,
      status: changeRequests.status
    })
    .from(changeRequests)
    .where(inArray(changeRequests.projectId, projectIds));

  for (const row of changeRows) {
    if (row.status === 'rejected' || row.status === 'implemented') {
      continue;
    }
    const counts = countsMap[row.projectId];
    if (counts) {
      counts.activeChangeCount += 1;
    }
  }

  const weeklyRows = await db
    .select({
      projectId: weeklyReports.projectId,
      createdAt: weeklyReports.createdAt
    })
    .from(weeklyReports)
    .where(inArray(weeklyReports.projectId, projectIds));

  for (const row of weeklyRows) {
    const counts = countsMap[row.projectId];
    if (!counts) {
      continue;
    }
    if (!counts.lastWeeklyReportAt || row.createdAt.getTime() > counts.lastWeeklyReportAt.getTime()) {
      counts.lastWeeklyReportAt = row.createdAt;
    }
  }

  return Object.fromEntries(
    projectIds.map((projectId) => [projectId, buildProjectPmSummary(countsMap[projectId], now)])
  );
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

export function parseAdapterConfig(raw: Record<string, unknown> | null | undefined): WorkspaceAdapterConfig {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  return raw as WorkspaceAdapterConfig;
}

export async function updateWorkspaceAdapterConfig(
  workspaceId: string,
  config: WorkspaceAdapterConfig
): Promise<void> {
  await db
    .update(workspaces)
    .set({ adapterConfig: config as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

export async function buildSetupStatus(
  workspace: SelectWorkspace,
  projectRows: SelectProject[],
  env: NodeJS.ProcessEnv = process.env
): Promise<SetupStatusResponse> {
  const syncInsights = await getProjectSyncEvidenceMap(workspace.id, projectRows);
  const pmSummaries = await getProjectPmSummaryMap(projectRows);
  const dbConfig = parseAdapterConfig(workspace.adapterConfig);
  const botId = dbConfig.wecom?.botId || env.WECOM_BOT_ID;
  const botSecret = dbConfig.wecom?.botSecret || env.WECOM_BOT_SECRET;
  const botConfigured = Boolean(botId && botSecret);
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
    adapterConfig: dbConfig,
    bot: {
      configured: botConfigured,
      botId: botId ?? null,
      connected: botConfigured
    },
    ai: {
      defaultModel: dbConfig.ai?.defaultModel || env.DEFAULT_AI_MODEL || 'claude',
      providers: buildProviderStatus(env, dbConfig.ai)
    },
    tencentdoc: {
      configured: tencentConfigured,
      appIdPreview: tencentConfigured ? 'Webhook 模式' : null
    },
    projects: projectRows.map((project) =>
      mapProjectToSetupSummary(
        project,
        syncInsights[project.id]?.evidence,
        syncInsights[project.id]?.recentSyncs ?? [],
        pmSummaries[project.id] ?? buildProjectPmSummary()
      )
    )
  };
}

export async function loadSetupStatus(env: NodeJS.ProcessEnv = process.env): Promise<SetupStatusResponse> {
  const workspace = await ensureDefaultWorkspace();
  const projectRows = await listWorkspaceProjects(workspace.id);
  return buildSetupStatus(workspace, projectRows, env);
}
