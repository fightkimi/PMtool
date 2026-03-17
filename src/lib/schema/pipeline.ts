import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

export const pipelineBusinessTypeValues = ['ui', 'skin', 'character', 'weapon', 'level', 'custom'] as const;
export type PipelineBusinessType = (typeof pipelineBusinessTypeValues)[number];

export const pipelineComplexityTierValues = ['s_plus', 's', 'a', 'b'] as const;
export type PipelineComplexityTier = (typeof pipelineComplexityTierValues)[number];

export type PipelineStageDefinition = {
  stage_key: string;
  role_type: string;
  name: string;
  default_weeks: number;
  depends_on: string[];
  deliverables: string[];
  can_parallel: boolean;
};

export type PipelineMilestoneAnchor = {
  name: string;
  offset_weeks: number;
};

export type PipelineVelocityHistoryEntry =
  | number
  | {
      multiplier: number;
      updated_at: string;
    };

export const pipelineBusinessTypeEnum = pgEnum('pipeline_business_type', pipelineBusinessTypeValues);
export const pipelineComplexityTierEnum = pgEnum('pipeline_complexity_tier', pipelineComplexityTierValues);

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  businessType: pipelineBusinessTypeEnum('business_type'),
  complexityTier: pipelineComplexityTierEnum('complexity_tier'),
  milestoneAnchors: jsonb('milestone_anchors').$type<PipelineMilestoneAnchor[]>().notNull().default(sql`'[]'::jsonb`),
  totalWeeksDefault: integer('total_weeks_default'),
  stages: jsonb('stages').$type<PipelineStageDefinition[]>().notNull().default(sql`'[]'::jsonb`),
  historicalVelocities: jsonb('historical_velocities')
    .$type<Record<string, PipelineVelocityHistoryEntry>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  isSystemTemplate: boolean('is_system_template').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
