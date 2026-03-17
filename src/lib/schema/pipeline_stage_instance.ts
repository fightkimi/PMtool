import { sql } from 'drizzle-orm';
import { jsonb, numeric, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { pipelineRuns } from './pipeline_run';
import { tasks } from './task';
import { users } from './user';

export const pipelineStageInstanceStatusValues = ['pending', 'active', 'blocked', 'review', 'done'] as const;
export type PipelineStageInstanceStatus = (typeof pipelineStageInstanceStatusValues)[number];

export const pipelineStageInstanceStatusEnum = pgEnum(
  'pipeline_stage_instance_status',
  pipelineStageInstanceStatusValues
);

export const pipelineStageInstances = pgTable('pipeline_stage_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  stageKey: varchar('stage_key', { length: 20 }).notNull(),
  roleType: varchar('role_type', { length: 50 }).notNull(),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  plannedStart: timestamp('planned_start', { withTimezone: true }),
  plannedEnd: timestamp('planned_end', { withTimezone: true }),
  actualStart: timestamp('actual_start', { withTimezone: true }),
  actualEnd: timestamp('actual_end', { withTimezone: true }),
  estimatedHours: numeric('estimated_hours', { precision: 6, scale: 1 }),
  dependsOn: jsonb('depends_on').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  floatDays: numeric('float_days', { precision: 5, scale: 1 }),
  status: pipelineStageInstanceStatusEnum('status').notNull().default('pending'),
  tableRecordId: varchar('table_record_id', { length: 100 }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
