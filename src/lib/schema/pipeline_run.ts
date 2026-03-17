import { pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { pipelineComplexityTierEnum } from './pipeline';
import { projects } from './project';
import { pipelines } from './pipeline';

export const pipelineRunStatusValues = ['planning', 'active', 'paused', 'completed', 'cancelled'] as const;
export type PipelineRunStatus = (typeof pipelineRunStatusValues)[number];

export const pipelineRunStatusEnum = pgEnum('pipeline_run_status', pipelineRunStatusValues);

export const pipelineRuns = pgTable('pipeline_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id')
    .notNull()
    .references(() => pipelines.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  complexityTier: pipelineComplexityTierEnum('complexity_tier'),
  status: pipelineRunStatusEnum('status').notNull().default('planning'),
  plannedEnd: timestamp('planned_end', { withTimezone: true }),
  actualEnd: timestamp('actual_end', { withTimezone: true }),
  versionTarget: varchar('version_target', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
