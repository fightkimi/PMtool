import { pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { pipelineRuns } from './pipeline_run';
import { projects } from './project';
import { tasks } from './task';

export const riskLevelValues = ['critical', 'high', 'medium', 'low'] as const;
export type RiskLevel = (typeof riskLevelValues)[number];

export const riskStatusValues = ['open', 'in_progress', 'resolved'] as const;
export type RiskStatus = (typeof riskStatusValues)[number];

export const riskDetectedByValues = ['agent', 'human'] as const;
export type RiskDetectedBy = (typeof riskDetectedByValues)[number];

export const riskLevelEnum = pgEnum('risk_level', riskLevelValues);
export const riskStatusEnum = pgEnum('risk_status', riskStatusValues);
export const riskDetectedByEnum = pgEnum('risk_detected_by', riskDetectedByValues);

export const risks = pgTable('risks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  runId: uuid('run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
  level: riskLevelEnum('level').notNull(),
  description: text('description').notNull(),
  status: riskStatusEnum('status').notNull().default('open'),
  mitigation: text('mitigation'),
  detectedBy: riskDetectedByEnum('detected_by').notNull().default('agent'),
  tableRecordId: varchar('table_record_id', { length: 100 }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
});
