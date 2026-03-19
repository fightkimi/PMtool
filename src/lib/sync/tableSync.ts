import { eq, inArray } from 'drizzle-orm';
import type { DocAdapter, DocRecord } from '@/adapters/types';
import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';
import { db } from '@/lib/db';
import { getProjectById } from '@/lib/queries/projects';
import { getTasksByProject } from '@/lib/queries/tasks';
import {
  capacitySnapshots,
  pipelineStageInstances,
  pipelineRuns,
  projects,
  risks,
  tasks,
  users,
  type InsertTask,
  type SelectCapacitySnapshot,
  type SelectPipelineRun,
  type SelectPipelineStageInstance,
  type SelectProject,
  type SelectRisk,
  type SelectTask
} from '@/lib/schema';

const RECORD_ID_FIELD = '__record_id';

function formatDate(value: Date | null | undefined): string {
  return value ? value.toLocaleDateString('zh-CN') : '';
}

function numericValue(value: number | string | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function getRecordId(record: DocRecord | null | undefined): string | null {
  const raw = record?.[RECORD_ID_FIELD];
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

function getProjectDocAdapter(
  docAdapter: DocAdapter,
  webhookUrl: string,
  schema: Record<string, string> | null | undefined
): DocAdapter {
  if (!(docAdapter instanceof TencentDocAdapter)) {
    return docAdapter;
  }

  return new TencentDocAdapter({
    webhookSchemas: {
      [webhookUrl]: schema ?? {}
    }
  });
}

async function getRunById(runId: string): Promise<SelectPipelineRun | null> {
  const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  return rows[0] ?? null;
}

export async function syncTaskToTable(
  task: SelectTask,
  project: SelectProject,
  docAdapter: DocAdapter
): Promise<void> {
  if (!project.taskTableWebhook) {
    return;
  }

  const projectDocAdapter = getProjectDocAdapter(docAdapter, project.taskTableWebhook, project.taskTableSchema);

  const fields: DocRecord = {
    任务名: task.title,
    状态: task.status,
    负责人: task.assigneeId ?? '',
    工种: task.department ?? '',
    估算工时: numericValue(task.estimatedHours),
    实际工时: numericValue(task.actualHours),
    截止日期: formatDate(task.dueAt),
    优先级: task.priority
  };

  if (task.tableRecordId) {
    await projectDocAdapter.updateRecord(project.taskTableWebhook, task.tableRecordId, fields);
    return;
  }

  const recordId = await projectDocAdapter.createRecord(project.taskTableWebhook, fields);
  if (recordId) {
    await db.update(tasks).set({ tableRecordId: recordId }).where(eq(tasks.id, task.id));
    task.tableRecordId = recordId;
  }
}

export async function syncStageToTable(
  stage: SelectPipelineStageInstance,
  project: SelectProject,
  runName: string,
  docAdapter: DocAdapter
): Promise<void> {
  if (!project.pipelineTableWebhook) {
    return;
  }

  const projectDocAdapter = getProjectDocAdapter(
    docAdapter,
    project.pipelineTableWebhook,
    project.pipelineTableSchema
  );

  const fields: DocRecord = {
    Run名: runName,
    阶段编号: stage.stageKey,
    工种: stage.roleType,
    负责人: stage.assigneeId ?? '',
    计划开始: formatDate(stage.plannedStart),
    计划结束: formatDate(stage.plannedEnd),
    浮动天数: numericValue(stage.floatDays),
    状态: stage.status
  };

  if (stage.tableRecordId) {
    await projectDocAdapter.updateRecord(project.pipelineTableWebhook, stage.tableRecordId, fields);
    return;
  }

  const recordId = await projectDocAdapter.createRecord(project.pipelineTableWebhook, fields);
  if (recordId) {
    await db
      .update(pipelineStageInstances)
      .set({ tableRecordId: recordId })
      .where(eq(pipelineStageInstances.id, stage.id));
    stage.tableRecordId = recordId;
  }
}

export async function syncRiskToTable(
  risk: SelectRisk,
  project: SelectProject,
  docAdapter: DocAdapter
): Promise<void> {
  if (!project.riskTableWebhook) {
    return;
  }

  const projectDocAdapter = getProjectDocAdapter(docAdapter, project.riskTableWebhook, project.riskTableSchema);

  const fields: DocRecord = {
    风险描述: risk.description,
    等级: risk.level,
    发现时间: formatDate(risk.createdAt),
    状态: risk.status,
    处理人: risk.taskId ?? risk.runId ?? ''
  };

  if (risk.tableRecordId) {
    await projectDocAdapter.updateRecord(project.riskTableWebhook, risk.tableRecordId, fields);
    return;
  }

  const recordId = await projectDocAdapter.createRecord(project.riskTableWebhook, fields);
  if (recordId) {
    await db.update(risks).set({ tableRecordId: recordId }).where(eq(risks.id, risk.id));
    risk.tableRecordId = recordId;
  }
}

export async function batchSyncTasksToTable(
  projectId: string,
  docAdapter: DocAdapter
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) {
    return;
  }

  const taskRows = await getTasksByProject(projectId);
  for (const task of taskRows) {
    await syncTaskToTable(task, project, docAdapter);
  }
}

export async function syncTaskRowsToTable(
  projectId: string,
  taskRows: SelectTask[],
  docAdapter: DocAdapter
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) {
    return;
  }

  for (const task of taskRows) {
    await syncTaskToTable(task, project, docAdapter);
  }
}

export async function syncTaskByIdToTable(taskId: string, docAdapter: DocAdapter): Promise<void> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId));
  const task = rows[0];
  if (!task) {
    return;
  }

  const project = await getProjectById(task.projectId);
  if (!project) {
    return;
  }

  await syncTaskToTable(task, project, docAdapter);
}

export async function syncStageByIdToTable(
  stageId: string,
  project: SelectProject,
  docAdapter: DocAdapter
): Promise<void> {
  const rows = await db.select().from(pipelineStageInstances).where(eq(pipelineStageInstances.id, stageId));
  const stage = rows[0];
  if (!stage) {
    return;
  }

  const run = await getRunById(stage.runId);
  await syncStageToTable(stage, project, run?.name ?? stage.runId, docAdapter);
}

export function tableRecordToTaskFields(record: DocRecord): Partial<InsertTask> {
  const fields: Partial<InsertTask> = {};

  if (typeof record.状态 === 'string') {
    fields.status = record.状态 as InsertTask['status'];
  }

  if (typeof record.实际工时 === 'number' || typeof record.实际工时 === 'string') {
    const value = Number(record.实际工时);
    if (!Number.isNaN(value)) {
      fields.actualHours = value;
    }
  }

  if (typeof record.截止日期 === 'string' && record.截止日期.trim()) {
    const parsed = new Date(record.截止日期);
    if (!Number.isNaN(parsed.getTime())) {
      fields.dueAt = parsed;
    }
  }

  return fields;
}

export async function getProjectForSync(projectId: string): Promise<SelectProject | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, projectId));
  return rows[0] ?? null;
}

export async function syncCapacitySnapshotsToTable(
  projectId: string,
  snapshots: Array<
    Pick<SelectCapacitySnapshot, 'userId' | 'roleType' | 'weekStart' | 'availableHours' | 'allocatedHours'>
  >,
  docAdapter: DocAdapter
): Promise<void> {
  const project = await getProjectForSync(projectId);
  if (!project?.capacityTableWebhook || snapshots.length === 0) {
    return;
  }

  const projectDocAdapter = getProjectDocAdapter(
    docAdapter,
    project.capacityTableWebhook,
    project.capacityTableSchema
  );

  const memberIds = [...new Set(snapshots.map((snapshot) => snapshot.userId).filter((value): value is string => Boolean(value)))];
  const memberRows = memberIds.length > 0 ? await db.select().from(users).where(inArray(users.id, memberIds)) : [];
  const memberById = new Map(memberRows.map((member) => [member.id, member]));
  const existingRows = await projectDocAdapter.readTable(project.capacityTableWebhook);

  for (const snapshot of snapshots) {
    const member = snapshot.userId ? memberById.get(snapshot.userId) : null;
    const memberLabel = member?.name ?? member?.imUserId ?? snapshot.userId ?? '未分配';
    const fields: DocRecord = {
      成员: memberLabel,
      工种: snapshot.roleType,
      周期: snapshot.weekStart,
      可用工时: numericValue(snapshot.availableHours),
      已分配: numericValue(snapshot.allocatedHours),
      负载率:
        numericValue(snapshot.availableHours) + numericValue(snapshot.allocatedHours) === 0
          ? 0
          : Math.round(
              (numericValue(snapshot.allocatedHours) /
                (numericValue(snapshot.availableHours) + numericValue(snapshot.allocatedHours))) *
                1000
            ) / 10
    };

    const existing = existingRows.find(
      (row) =>
        String(row.成员 ?? '') === memberLabel &&
        String(row.工种 ?? '') === snapshot.roleType &&
        String(row.周期 ?? '') === snapshot.weekStart
    );
    const recordId = getRecordId(existing);

    if (recordId) {
      await projectDocAdapter.updateRecord(project.capacityTableWebhook, recordId, fields);
      continue;
    }

    await projectDocAdapter.createRecord(project.capacityTableWebhook, fields);
  }
}
