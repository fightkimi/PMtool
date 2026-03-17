import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const workspacePlanValues = ['free', 'pro', 'enterprise'] as const;
export type WorkspacePlan = (typeof workspacePlanValues)[number];

export const workspacePlanEnum = pgEnum('workspace_plan', workspacePlanValues);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  plan: workspacePlanEnum('plan').notNull().default('free'),
  adapterConfig: jsonb('adapter_config')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
