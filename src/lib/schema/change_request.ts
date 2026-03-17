import { sql } from 'drizzle-orm';
import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { projects } from './project';
import { pipelineRuns } from './pipeline_run';
import { users } from './user';

export const changeRequestSourceValues = ['requirement', 'scope', 'resource', 'external'] as const;
export type ChangeRequestSource = (typeof changeRequestSourceValues)[number];

export const changeRequestStatusValues = ['draft', 'evaluating', 'approved', 'rejected', 'implemented'] as const;
export type ChangeRequestStatus = (typeof changeRequestStatusValues)[number];

export const changeRequestSourceEnum = pgEnum('change_request_source', changeRequestSourceValues);
export const changeRequestStatusEnum = pgEnum('change_request_status', changeRequestStatusValues);

export const changeRequests = pgTable('change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  source: changeRequestSourceEnum('source').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  status: changeRequestStatusEnum('status').notNull().default('draft'),
  affectedTaskIds: uuid('affected_task_ids').array().notNull().default(sql`'{}'::uuid[]`),
  affectedRunIds: uuid('affected_run_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
  evaluationByAgent: jsonb('evaluation_by_agent').$type<Record<string, unknown>>(),
  cascadeExecutedAt: timestamp('cascade_executed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
