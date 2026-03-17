import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  pipelineStageInstances,
  type InsertPipelineStageInstance,
  type SelectPipelineStageInstance
} from '@/lib/schema';

export async function getStagesByRun(runId: string): Promise<SelectPipelineStageInstance[]> {
  return db.select().from(pipelineStageInstances).where(eq(pipelineStageInstances.runId, runId));
}

export async function batchUpdateStages(
  updates: Array<{ id: string; data: Partial<InsertPipelineStageInstance> }>
): Promise<void> {
  await Promise.all(
    updates.map(({ id, data }) =>
      db.update(pipelineStageInstances).set(data).where(eq(pipelineStageInstances.id, id))
    )
  );
}

export async function getStagesByAssignee(
  userId: string,
  from: Date,
  to: Date
): Promise<SelectPipelineStageInstance[]> {
  return db
    .select()
    .from(pipelineStageInstances)
    .where(
      and(
        eq(pipelineStageInstances.assigneeId, userId),
        gte(pipelineStageInstances.plannedStart, from),
        lte(pipelineStageInstances.plannedEnd, to)
      )
    );
}
