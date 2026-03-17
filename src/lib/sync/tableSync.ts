import { eq } from 'drizzle-orm';
import type { DocAdapter, DocRecord } from '@/adapters/types';
import { db } from '@/lib/db';
import { getProjectById } from '@/lib/queries/projects';
import { getTasksByProject } from '@/lib/queries/tasks';
import {
  pipelineStageInstances,
  pipelineRuns,
  projects,
  risks,
  tasks,
  type InsertTask,
  type SelectPipelineRun,
  type SelectPipelineStageInstance,
  type SelectProject,
  type SelectRisk,
  type SelectTask
} from '@/lib/schema';

function formatDate(value: Date | null | undefined): string {
  return value ? value.toLocaleDateString('zh-CN') : '';
}

function numericValue(value: string | null | undefined): number {
  return value == null ? 0 : Number(value);
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
  if (!project.taskTableId) {
    return;
  }

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
    await docAdapter.updateRecord(project.taskTableId, task.tableRecordId, fields);
    return;
  }

  const recordId = await docAdapter.createRecord(project.taskTableId, fields);
  await db.update(tasks).set({ tableRecordId: recordId }).where(eq(tasks.id, task.id));
  task.tableRecordId = recordId;
}

export async function syncStageToTable(
  stage: SelectPipelineStageInstance,
  project: SelectProject,
  runName: string,
  docAdapter: DocAdapter
): Promise<void> {
  if (!project.pipelineTableId) {
    return;
  }

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
    await docAdapter.updateRecord(project.pipelineTableId, stage.tableRecordId, fields);
    return;
  }

  const recordId = await docAdapter.createRecord(project.pipelineTableId, fields);
  await db.update(pipelineStageInstances).set({ tableRecordId: recordId }).where(eq(pipelineStageInstances.id, stage.id));
  stage.tableRecordId = recordId;
}

export async function syncRiskToTable(
  risk: SelectRisk,
  project: SelectProject,
  docAdapter: DocAdapter
): Promise<void> {
  if (!project.riskTableId) {
    return;
  }

  const fields: DocRecord = {
    风险描述: risk.description,
    等级: risk.level,
    发现时间: formatDate(risk.createdAt),
    状态: risk.status,
    处理人: risk.taskId ?? risk.runId ?? ''
  };

  if (risk.tableRecordId) {
    await docAdapter.updateRecord(project.riskTableId, risk.tableRecordId, fields);
    return;
  }

  const recordId = await docAdapter.createRecord(project.riskTableId, fields);
  await db.update(risks).set({ tableRecordId: recordId }).where(eq(risks.id, risk.id));
  risk.tableRecordId = recordId;
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
      fields.actualHours = String(value);
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
