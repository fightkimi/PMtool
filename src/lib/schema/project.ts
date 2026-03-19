import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './user';
import { workspaces } from './workspace';

export const projectTypeValues = ['game_dev', 'outsource', 'office_app', 'custom'] as const;
export type ProjectType = (typeof projectTypeValues)[number];

export const projectStatusValues = ['planning', 'active', 'paused', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof projectStatusValues)[number];

export const projectTypeEnum = pgEnum('project_type', projectTypeValues);
export const projectStatusEnum = pgEnum('project_status', projectStatusValues);

export type ProjectBudget = {
  total: number;
  spent: number;
  token_budget: number;
};

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  type: projectTypeEnum('type').notNull(),
  status: projectStatusEnum('status').notNull().default('planning'),
  pmId: uuid('pm_id').references(() => users.id, { onDelete: 'set null' }),
  wecomGroupId: varchar('wecom_group_id', { length: 100 }),
  wecomBotWebhook: varchar('wecom_bot_webhook', { length: 500 }),
  wecomMgmtGroupId: varchar('wecom_mgmt_group_id', { length: 100 }),
  smartTableRootId: varchar('smart_table_root_id', { length: 100 }),
  taskTableWebhook: varchar('task_table_webhook', { length: 500 }),
  taskTableSchema: jsonb('task_table_schema').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  pipelineTableWebhook: varchar('pipeline_table_webhook', { length: 500 }),
  pipelineTableSchema: jsonb('pipeline_table_schema').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  capacityTableWebhook: varchar('capacity_table_webhook', { length: 500 }),
  capacityTableSchema: jsonb('capacity_table_schema').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  riskTableWebhook: varchar('risk_table_webhook', { length: 500 }),
  riskTableSchema: jsonb('risk_table_schema').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  changeTableWebhook: varchar('change_table_webhook', { length: 500 }),
  changeTableSchema: jsonb('change_table_schema').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  githubRepo: varchar('github_repo', { length: 200 }),
  budget: jsonb('budget')
    .$type<ProjectBudget>()
    .notNull()
    .default(sql`'{"total":0,"spent":0,"token_budget":0}'::jsonb`),
  startedAt: timestamp('started_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
