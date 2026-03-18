import { db } from '@/lib/db';
import {
  pipelineRuns,
  pipelineStageInstances,
  type InsertPipelineRun,
  type InsertPipelineStageInstance,
  type PipelineComplexityTier,
  type SelectPipeline,
  type SelectPipelineRun
} from '@/lib/schema';

type DeliverableInput = {
  name: string;
  complexity_tier: PipelineComplexityTier;
  notes: string;
};

type PipelineInstantiatorDeps = {
  createPipelineRun?: (data: InsertPipelineRun) => Promise<SelectPipelineRun>;
  batchInsertStageInstances?: (data: InsertPipelineStageInstance[]) => Promise<void>;
  computeCriticalPath?: (runId: string) => Promise<void>;
  logger?: Pick<Console, 'log' | 'error'>;
};

const tierFactorMap: Record<PipelineComplexityTier, number> = {
  s_plus: 1.4,
  s: 1.2,
  a: 1.0,
  b: 0.7
};

export class PipelineInstantiator {
  private readonly createPipelineRunFn: (data: InsertPipelineRun) => Promise<SelectPipelineRun>;

  private readonly batchInsertStageInstancesFn: (data: InsertPipelineStageInstance[]) => Promise<void>;

  private readonly computeCriticalPathFn?: (runId: string) => Promise<void>;

  private readonly logger: Pick<Console, 'log' | 'error'>;

  constructor(deps: PipelineInstantiatorDeps = {}) {
    this.createPipelineRunFn =
      deps.createPipelineRun ??
      (async (data) => {
        const rows = await db.insert(pipelineRuns).values(data).returning();
        return rows[0]!;
      });
    this.batchInsertStageInstancesFn =
      deps.batchInsertStageInstances ??
      (async (data) => {
        if (data.length > 0) {
          await db.insert(pipelineStageInstances).values(data);
        }
      });
    this.computeCriticalPathFn = deps.computeCriticalPath;
    this.logger = deps.logger ?? console;
  }

  async instantiate(
    pipeline: SelectPipeline,
    deliverable: DeliverableInput,
    projectId: string
  ): Promise<SelectPipelineRun> {
    const run = await this.createPipelineRunFn({
      pipelineId: pipeline.id,
      projectId,
      name: deliverable.name,
      complexityTier: deliverable.complexity_tier,
      status: 'planning'
    });

    const factor = tierFactorMap[deliverable.complexity_tier];
    const stageInserts: InsertPipelineStageInstance[] = pipeline.stages.map((stage) => ({
      runId: run.id,
      stageKey: stage.stage_key,
      roleType: stage.role_type,
      estimatedHours: Math.round(stage.default_weeks * 5 * factor * 10) / 10,
      dependsOn: stage.depends_on,
      status: 'pending'
    }));

    await this.batchInsertStageInstancesFn(stageInserts);

    this.logger.log('Pipeline stage schedule synced to table placeholder', {
      projectId,
      runId: run.id,
      deliverable: deliverable.name
    });

    try {
      await this.computeCriticalPathFn?.(run.id);
    } catch (error) {
      this.logger.error('CPM compute failed', error);
    }

    return run;
  }
}
