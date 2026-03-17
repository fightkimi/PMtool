import { sql } from 'drizzle-orm';
import { boolean, date, jsonb, numeric, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './user';
import { workspaces } from './workspace';

export const capacitySnapshots = pgTable('capacity_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  snapshotDate: date('snapshot_date').notNull(),
  weekStart: date('week_start').notNull(),
  roleType: varchar('role_type', { length: 50 }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  totalHours: numeric('total_hours', { precision: 6, scale: 1 }).notNull().default('40'),
  allocatedHours: numeric('allocated_hours', { precision: 6, scale: 1 }).notNull().default('0'),
  availableHours: numeric('available_hours', { precision: 6, scale: 1 }).notNull().default('40'),
  projectBreakdown: jsonb('project_breakdown')
    .$type<Record<string, number>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  overloadFlag: boolean('overload_flag').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
