import { sql } from 'drizzle-orm';
import { jsonb, numeric, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

export const userRoleValues = ['pm', 'dev', 'qa', 'designer', 'manager'] as const;
export type UserRole = (typeof userRoleValues)[number];

export const userRoleEnum = pgEnum('user_role', userRoleValues);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  role: userRoleEnum('role').notNull(),
  imUserId: varchar('im_user_id', { length: 100 }),
  workHoursPerWeek: numeric('work_hours_per_week', { precision: 4, scale: 1 }).notNull().default('40'),
  skills: jsonb('skills').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
