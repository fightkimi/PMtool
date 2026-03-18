import { sql } from 'drizzle-orm';
import {
  foreignKey,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { projects } from './project';
import { users } from './user';

export const taskStatusValues = ['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof taskStatusValues)[number];

export const taskPriorityValues = ['critical', 'high', 'medium', 'low'] as const;
export type TaskPriority = (typeof taskPriorityValues)[number];

export const taskDepartmentValues = [
  'libu_li',
  'libu_hu',
  'libu_li2',
  'libu_bing',
  'libu_xing',
  'libu_gong'
] as const;
export type TaskDepartment = (typeof taskDepartmentValues)[number];

export const taskStatusEnum = pgEnum('task_status', taskStatusValues);
export const taskPriorityEnum = pgEnum('task_priority', taskPriorityValues);
export const taskDepartmentEnum = pgEnum('task_department', taskDepartmentValues);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    department: taskDepartmentEnum('department'),
    estimatedHours: numeric('estimated_hours', { precision: 5, scale: 1, mode: 'number' }),
    actualHours: numeric('actual_hours', { precision: 5, scale: 1, mode: 'number' }),
    earliestStart: timestamp('earliest_start', { withTimezone: true }),
    latestFinish: timestamp('latest_finish', { withTimezone: true }),
    floatDays: numeric('float_days', { precision: 5, scale: 1, mode: 'number' }),
    githubIssueNumber: integer('github_issue_number'),
    acceptanceCriteria: text('acceptance_criteria')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tableRecordId: varchar('table_record_id', { length: 100 }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'tasks_parent_id_tasks_id_fk'
    }).onDelete('set null')
  ]
);
