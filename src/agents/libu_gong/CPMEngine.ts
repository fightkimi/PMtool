import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { registry } from '@/adapters/registry';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import { db } from '@/lib/db';
import { batchUpdateStages, getStagesByRun } from '@/lib/queries/pipeline_stage_instances';
import {
  pipelineRuns,
  pipelineStageInstances,
  pipelines,
  projects,
  type InsertPipelineStageInstance,
  type SelectPipeline,
  type SelectPipelineRun,
  type SelectPipelineStageInstance,
  type SelectProject
} from '@/lib/schema';

export interface CriticalPathResult {
  critical_path: string[];
  float_map: Record<string, number>;
  conflicts: Conflict[];
}

export interface CascadeResult {
  affected_stage_ids: string[];
  milestone_impact: boolean;
  conflicts: Conflict[];
}

export interface Conflict {
  stage1_id: string;
  stage2_id: string;
  assignee_id: string;
  overlap_days: number;
}

type StageNode = SelectPipelineStageInstance;

type CPMDeps = {
  getStagesByRun?: typeof getStagesByRun;
  batchUpdateStages?: typeof batchUpdateStages;
  getStageById?: (id: string) => Promise<SelectPipelineStageInstance | null>;
  getRunById?: (id: string) => Promise<SelectPipelineRun | null>;
  getPipelineById?: (id: string) => Promise<SelectPipeline | null>;
  getProjectById?: (id: string) => Promise<SelectProject | null>;
  getStagesByProjectId?: (projectId: string) => Promise<SelectPipelineStageInstance[]>;
  queue?: Pick<AgentQueue, 'enqueue'>;
  imAdapter?: ReturnType<typeof registry.getIM>;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
};

type GraphBuildResult = {
  nodes: Map<string, StageNode>;
  successors: Map<string, string[]>;
  predecessors: Map<string, string[]>;
  topoOrder: string[];
};

function durationDays(stage: Pick<SelectPipelineStageInstance, 'estimatedHours'>): number {
  const hours = stage.estimatedHours == null ? 0 : Number(stage.estimatedHours);
  return Math.max(1, Math.ceil(hours / 8));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysFromAnchor(anchor: Date, date: Date | null | undefined): number | null {
  if (!date) {
    return null;
  }

  return Math.ceil((date.getTime() - anchor.getTime()) / 86400000);
}

function overlapDays(start1: Date, end1: Date, start2: Date, end2: Date): number {
  const overlapStart = Math.max(start1.getTime(), start2.getTime());
  const overlapEnd = Math.min(end1.getTime(), end2.getTime());
  return Math.max(0, Math.ceil((overlapEnd - overlapStart) / 86400000));
}

export class CPMEngine {
  private readonly getStagesByRunFn: typeof getStagesByRun;

  private readonly batchUpdateStagesFn: typeof batchUpdateStages;

  private readonly getStageByIdFn: (id: string) => Promise<SelectPipelineStageInstance | null>;

  private readonly getRunByIdFn: (id: string) => Promise<SelectPipelineRun | null>;

  private readonly getPipelineByIdFn: (id: string) => Promise<SelectPipeline | null>;

  private readonly getProjectByIdFn: (id: string) => Promise<SelectProject | null>;

  private readonly getStagesByProjectIdFn: (projectId: string) => Promise<SelectPipelineStageInstance[]>;

  private readonly queue: Pick<AgentQueue, 'enqueue'>;

  private readonly imAdapter: ReturnType<typeof registry.getIM>;

  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;

  constructor(deps: CPMDeps = {}) {
    this.getStagesByRunFn = deps.getStagesByRun ?? getStagesByRun;
    this.batchUpdateStagesFn = deps.batchUpdateStages ?? batchUpdateStages;
    this.getStageByIdFn = deps.getStageById ?? defaultGetStageById;
    this.getRunByIdFn = deps.getRunById ?? defaultGetRunById;
    this.getPipelineByIdFn = deps.getPipelineById ?? defaultGetPipelineById;
    this.getProjectByIdFn = deps.getProjectById ?? defaultGetProjectById;
    this.getStagesByProjectIdFn = deps.getStagesByProjectId ?? defaultGetStagesByProjectId;
    this.queue = deps.queue ?? agentQueue;
    this.imAdapter = deps.imAdapter ?? registry.getIM();
    this.logger = deps.logger ?? console;
  }

  async computeCriticalPath(runId: string): Promise<CriticalPathResult> {
    const run = await this.getRunByIdFn(runId);
    if (!run) {
      throw new Error(`Pipeline run not found: ${runId}`);
    }

    const stages = await this.getStagesByRunFn(runId);
    const graph = this.buildGraph(stages);
    const earlyStart = new Map<string, number>();
    const earlyFinish = new Map<string, number>();

    for (const id of graph.topoOrder) {
      const stage = graph.nodes.get(id)!;
      const predecessors = graph.predecessors.get(id) ?? [];
      const es = predecessors.length === 0 ? 0 : Math.max(...predecessors.map((item) => earlyFinish.get(item) ?? 0));
      const ef = es + durationDays(stage);
      earlyStart.set(id, es);
      earlyFinish.set(id, ef);
    }

    const computedDeadline = Math.max(...Array.from(earlyFinish.values()), 0);
    const explicitDeadline = daysFromAnchor(run.createdAt, run.plannedEnd);
    const deadline = explicitDeadline == null ? computedDeadline : Math.min(explicitDeadline, computedDeadline);

    const lateStart = new Map<string, number>();
    const lateFinish = new Map<string, number>();
    const floatMap: Record<string, number> = {};
    const updates: Array<{ id: string; data: Partial<InsertPipelineStageInstance> }> = [];

    for (const id of [...graph.topoOrder].reverse()) {
      const stage = graph.nodes.get(id)!;
      const successors = graph.successors.get(id) ?? [];
      const lf = successors.length === 0 ? deadline : Math.min(...successors.map((item) => lateStart.get(item) ?? deadline));
      const ls = lf - durationDays(stage);
      lateFinish.set(id, lf);
      lateStart.set(id, ls);

      let floatDays = ls - (earlyStart.get(id) ?? 0);
      if (floatDays < 0) {
        this.logger.warn(`Negative float detected for stage ${stage.stageKey}`);
        floatDays = 0;
      }

      floatMap[stage.stageKey] = floatDays;
      updates.push({
        id,
        data: {
          plannedStart: addDays(run.createdAt, earlyStart.get(id) ?? 0),
          plannedEnd: addDays(run.createdAt, earlyFinish.get(id) ?? 0),
          floatDays: String(floatDays)
        }
      });
    }

    if (updates.length > 0) {
      await this.batchUpdateStagesFn(updates);
      this.logger.log('Sync pipeline schedule placeholder', { runId, stageCount: updates.length });
    }

    const refreshedStages = stages.map((stage) => {
      const update = updates.find((item) => item.id === stage.id);
      return {
        ...stage,
        plannedStart: (update?.data.plannedStart as Date | undefined) ?? stage.plannedStart,
        plannedEnd: (update?.data.plannedEnd as Date | undefined) ?? stage.plannedEnd,
        floatDays: (update?.data.floatDays as string | undefined) ?? stage.floatDays
      };
    });

    return {
      critical_path: graph.topoOrder
        .map((id) => graph.nodes.get(id)!)
        .filter((stage) => floatMap[stage.stageKey] === 0)
        .map((stage) => stage.stageKey),
      float_map: floatMap,
      conflicts: this.detectConflicts(refreshedStages)
    };
  }

  async cascadeUpdate(stageInstanceId: string, newEndDate: Date): Promise<CascadeResult> {
    const sourceStage = await this.getStageByIdFn(stageInstanceId);
    if (!sourceStage) {
      throw new Error(`Stage instance not found: ${stageInstanceId}`);
    }

    const run = await this.getRunByIdFn(sourceStage.runId);
    if (!run) {
      throw new Error(`Pipeline run not found: ${sourceStage.runId}`);
    }

    const stages = await this.getStagesByRunFn(sourceStage.runId);
    const graph = this.buildGraph(stages);
    const nodes = graph.nodes;
    const successors = graph.successors;
    const topoIndex = new Map(graph.topoOrder.map((id, index) => [id, index]));
    const sourceNode = nodes.get(stageInstanceId)!;
    const originalDuration = durationDays(sourceNode);
    const updatedSourceEnd = newEndDate;
    const stageTimes = new Map<
      string,
      { plannedStart: Date | null; plannedEnd: Date | null; floatDays: number }
    >();

    for (const stage of stages) {
      stageTimes.set(stage.id, {
        plannedStart: stage.plannedStart,
        plannedEnd: stage.plannedEnd,
        floatDays: Number(stage.floatDays ?? '0')
      });
    }

    const sourceStart = addDays(updatedSourceEnd, -originalDuration);
    stageTimes.set(stageInstanceId, {
      plannedStart: sourceStart,
      plannedEnd: updatedSourceEnd,
      floatDays: Number(sourceNode.floatDays ?? '0')
    });

    const affected = new Set<string>();
    const queue: string[] = [...(successors.get(stageInstanceId) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (affected.has(current)) {
        continue;
      }

      affected.add(current);
      for (const next of successors.get(current) ?? []) {
        queue.push(next);
      }
    }

    const orderedAffected = [...affected].sort((a, b) => (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0));
    const updates: Array<{ id: string; data: Partial<InsertPipelineStageInstance> }> = [];

    for (const id of orderedAffected) {
      const stage = nodes.get(id)!;
      const predecessors = graph.predecessors.get(id) ?? [];
      const predecessorEnd = predecessors
        .map((predId) => stageTimes.get(predId)?.plannedEnd)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const nextStart = predecessorEnd ?? stage.plannedStart ?? run.createdAt;
      const nextEnd = addDays(nextStart, durationDays(stage));
      stageTimes.set(id, {
        plannedStart: nextStart,
        plannedEnd: nextEnd,
        floatDays: Number(stage.floatDays ?? '0')
      });
      updates.push({
        id,
        data: {
          plannedStart: nextStart,
          plannedEnd: nextEnd
        }
      });
    }

    if (updates.length > 0) {
      await this.batchUpdateStagesFn(updates);
      this.logger.log('Cascade sync placeholder', { runId: run.id, affectedCount: updates.length });
    }

    const pipeline = await this.getPipelineByIdFn(run.pipelineId);
    const project = await this.getProjectByIdFn(run.projectId);
    let milestoneImpact = false;
    let milestoneMessage: string | null = null;

    if (pipeline && project) {
      for (const anchor of pipeline.milestoneAnchors) {
        const anchorDate = addDays(run.createdAt, anchor.offset_weeks * 7);
        const impactedStage = stages
          .filter((stage) => affected.has(stage.id))
          .map((stage) => ({
            stage,
            end: stageTimes.get(stage.id)?.plannedEnd ?? stage.plannedEnd
          }))
          .find((item) => item.end != null && item.end.getTime() > anchorDate.getTime());

        if (impactedStage?.end) {
          milestoneImpact = true;
          const delayDays = Math.ceil((impactedStage.end.getTime() - anchorDate.getTime()) / 86400000);
          milestoneMessage = `⚠️ 版本节点风险：${anchor.name} 可能延期 ${delayDays} 天`;
          break;
        }
      }
    }

    const affectedStages = stages
      .filter((stage) => affected.has(stage.id))
      .map((stage) => ({
        ...stage,
        plannedStart: stageTimes.get(stage.id)?.plannedStart ?? stage.plannedStart,
        plannedEnd: stageTimes.get(stage.id)?.plannedEnd ?? stage.plannedEnd
      }));

    if (affectedStages.some((stage) => Number(stage.floatDays ?? '0') === 0)) {
      await this.queue.enqueue({
        id: randomUUID(),
        from: 'libu_gong',
        to: 'libu_bing',
        type: 'request',
        payload: { type: 'critical_path_alert', run_id: run.id, stage_ids: orderedAffected },
        context: {
          workspace_id: project?.workspaceId ?? '',
          project_id: project?.id,
          job_id: randomUUID(),
          trace_ids: []
        },
        priority: 1,
        created_at: new Date().toISOString()
      });
    }

    if (milestoneImpact && project && milestoneMessage) {
      await this.queue.enqueue({
        id: randomUUID(),
        from: 'libu_gong',
        to: 'zhongshui',
        type: 'escalate',
        payload: { reason: milestoneMessage, run_id: run.id },
        context: {
          workspace_id: project.workspaceId,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        },
        priority: 1,
        created_at: new Date().toISOString()
      });
      const target = project.wecomBotWebhook ?? project.wecomGroupId ?? project.wecomMgmtGroupId;
      if (target) {
        await this.imAdapter.sendCard(target, {
          title: '⚠️ 版本节点风险',
          content: milestoneMessage
        });
      }
    }

    return {
      affected_stage_ids: orderedAffected,
      milestone_impact: milestoneImpact,
      conflicts: this.detectConflicts(affectedStages)
    };
  }

  detectConflicts(stages: SelectPipelineStageInstance[]): Conflict[] {
    const byAssignee = new Map<string, SelectPipelineStageInstance[]>();
    for (const stage of stages) {
      if (!stage.assigneeId) {
        continue;
      }
      byAssignee.set(stage.assigneeId, [...(byAssignee.get(stage.assigneeId) ?? []), stage]);
    }

    const conflicts: Conflict[] = [];
    for (const [assigneeId, items] of byAssignee.entries()) {
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const stage1 = items[i];
          const stage2 = items[j];
          if (!stage1.plannedStart || !stage1.plannedEnd || !stage2.plannedStart || !stage2.plannedEnd) {
            continue;
          }

          if (
            stage1.plannedStart.getTime() < stage2.plannedEnd.getTime() &&
            stage2.plannedStart.getTime() < stage1.plannedEnd.getTime()
          ) {
            conflicts.push({
              stage1_id: stage1.id,
              stage2_id: stage2.id,
              assignee_id: assigneeId,
              overlap_days: overlapDays(stage1.plannedStart, stage1.plannedEnd, stage2.plannedStart, stage2.plannedEnd)
            });
          }
        }
      }
    }

    return conflicts;
  }

  async getTimelineSummary(projectId: string): Promise<{
    role_view: Array<{ role_type: string; current_stage: string; next_stage: string | null }>;
    run_view: Array<{ run_name: string; progress_pct: number; current_stage: string }>;
  }> {
    const stages = await this.getStagesByProjectIdFn(projectId);
    const activeStages = stages.filter((stage) => stage.status === 'active' || stage.status === 'pending');

    const roleGroups = new Map<string, SelectPipelineStageInstance[]>();
    for (const stage of activeStages) {
      roleGroups.set(stage.roleType, [...(roleGroups.get(stage.roleType) ?? []), stage]);
    }

    const role_view = [...roleGroups.entries()].map(([roleType, items]) => {
      const sorted = [...items].sort((a, b) => {
        const aTime = a.plannedStart?.getTime() ?? 0;
        const bTime = b.plannedStart?.getTime() ?? 0;
        return aTime - bTime;
      });
      return {
        role_type: roleType,
        current_stage: sorted[0]?.stageKey ?? '',
        next_stage: sorted[1]?.stageKey ?? null
      };
    });

    const runIds = [...new Set(activeStages.map((stage) => stage.runId))];
    const runs = runIds.length === 0 ? [] : await db.select().from(pipelineRuns).where(inArray(pipelineRuns.id, runIds));
    const run_view = runs.map((run) => {
      const runStages = stages.filter((stage) => stage.runId === run.id);
      const doneCount = runStages.filter((stage) => stage.status === 'done').length;
      const currentStage =
        runStages.find((stage) => stage.status === 'active')?.stageKey ??
        runStages.find((stage) => stage.status === 'pending')?.stageKey ??
        '';
      return {
        run_name: run.name,
        progress_pct: runStages.length === 0 ? 0 : Math.round((doneCount / runStages.length) * 100),
        current_stage: currentStage
      };
    });

    return { role_view, run_view };
  }

  private buildGraph(stages: SelectPipelineStageInstance[]): GraphBuildResult {
    const nodes = new Map(stages.map((stage) => [stage.id, stage]));
    const byStageKey = new Map(stages.map((stage) => [stage.stageKey, stage.id]));
    const successors = new Map<string, string[]>();
    const predecessors = new Map<string, string[]>();
    const indegree = new Map<string, number>();

    for (const stage of stages) {
      successors.set(stage.id, []);
      predecessors.set(stage.id, []);
      indegree.set(stage.id, 0);
    }

    for (const stage of stages) {
      const dependencyIds = (stage.dependsOn ?? [])
        .map((stageKey) => byStageKey.get(stageKey))
        .filter((value): value is string => Boolean(value));
      predecessors.set(stage.id, dependencyIds);
      indegree.set(stage.id, dependencyIds.length);

      for (const dependencyId of dependencyIds) {
        successors.set(dependencyId, [...(successors.get(dependencyId) ?? []), stage.id]);
      }
    }

    const queue: string[] = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
    const topoOrder: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      topoOrder.push(current);
      for (const next of successors.get(current) ?? []) {
        const nextDegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextDegree);
        if (nextDegree === 0) {
          queue.push(next);
        }
      }
    }

    if (topoOrder.length < stages.length) {
      throw new Error('Cycle detected in pipeline stages');
    }

    return { nodes, successors, predecessors, topoOrder };
  }
}

export const cpmEngine = new CPMEngine();

/* v8 ignore next */
async function defaultGetStageById(id: string): Promise<SelectPipelineStageInstance | null> {
  const rows = await db.select().from(pipelineStageInstances).where(eq(pipelineStageInstances.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetRunById(id: string): Promise<SelectPipelineRun | null> {
  const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetPipelineById(id: string): Promise<SelectPipeline | null> {
  const rows = await db.select().from(pipelines).where(eq(pipelines.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetProjectById(id: string): Promise<SelectProject | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id));
  return rows[0] ?? null;
}

/* v8 ignore next */
async function defaultGetStagesByProjectId(projectId: string): Promise<SelectPipelineStageInstance[]> {
  const runs = await db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  if (runs.length === 0) {
    return [];
  }

  return db
    .select()
    .from(pipelineStageInstances)
    .where(inArray(pipelineStageInstances.runId, runs.map((run) => run.id)));
}
