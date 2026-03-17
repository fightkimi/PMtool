import { sql } from 'drizzle-orm';
import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './project';

export const postMortems = pgTable('post_mortems', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  scheduleAccuracy: numeric('schedule_accuracy', { precision: 5, scale: 2 }),
  estimateAccuracy: numeric('estimate_accuracy', { precision: 5, scale: 2 }),
  riskHitRate: numeric('risk_hit_rate', { precision: 5, scale: 2 }),
  velocityByRole: jsonb('velocity_by_role')
    .$type<Record<string, number>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  changeRequestCount: integer('change_request_count').notNull().default(0),
  lessonsLearned: text('lessons_learned').array().notNull().default(sql`'{}'::text[]`),
  recommendations: text('recommendations').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
