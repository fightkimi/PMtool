import { jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar, integer } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

export const agentTypeValues = [
  'zhongshui',
  'zhongshu',
  'menxia',
  'shangshu',
  'libu_li',
  'libu_hu',
  'libu_li2',
  'libu_bing',
  'libu_xing',
  'libu_gong',
  'capacity',
  'postmortem'
] as const;
export type AgentType = (typeof agentTypeValues)[number];

export const agentTriggerValues = ['scheduled', 'event', 'manual', 'agent_chain'] as const;
export type AgentTrigger = (typeof agentTriggerValues)[number];

export const agentJobStatusValues = ['pending', 'running', 'success', 'failed', 'vetoed'] as const;
export type AgentJobStatus = (typeof agentJobStatusValues)[number];

export const agentTypeEnum = pgEnum('agent_type', agentTypeValues);
export const agentTriggerEnum = pgEnum('agent_trigger', agentTriggerValues);
export const agentJobStatusEnum = pgEnum('agent_job_status', agentJobStatusValues);

export const agentJobs = pgTable('agent_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentType: agentTypeEnum('agent_type').notNull(),
  trigger: agentTriggerEnum('trigger').notNull(),
  input: jsonb('input').$type<Record<string, unknown>>().notNull(),
  output: jsonb('output').$type<Record<string, unknown>>(),
  status: agentJobStatusEnum('status').notNull().default('pending'),
  modelUsed: varchar('model_used', { length: 100 }),
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
