import { boolean, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './project';

export const weeklyReports = pgTable('weekly_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  weekStart: date('week_start').notNull(),
  content: text('content').notNull(),
  generatedByAgent: boolean('generated_by_agent').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
