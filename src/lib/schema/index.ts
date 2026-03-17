import { agentJobs } from './agent_job';
import { capacitySnapshots } from './capacity_snapshot';
import { changeRequests } from './change_request';
import { pipelineRuns } from './pipeline_run';
import { pipelineStageInstances } from './pipeline_stage_instance';
import { pipelines } from './pipeline';
import { postMortems } from './post_mortem';
import { projects } from './project';
import { risks } from './risk';
import { tasks } from './task';
import { users } from './user';
import { weeklyReports } from './weekly_report';
import { workspaces } from './workspace';

export * from './agent_job';
export * from './capacity_snapshot';
export * from './change_request';
export * from './pipeline';
export * from './pipeline_run';
export * from './pipeline_stage_instance';
export * from './post_mortem';
export * from './project';
export * from './risk';
export * from './task';
export * from './user';
export * from './weekly_report';
export * from './workspace';

export { agentJobs, capacitySnapshots, changeRequests, pipelineRuns, pipelineStageInstances, pipelines, postMortems, projects, risks, tasks, users, weeklyReports, workspaces };

export type SelectWorkspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;

export type SelectUser = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type SelectProject = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

export type SelectTask = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export type SelectPipeline = typeof pipelines.$inferSelect;
export type InsertPipeline = typeof pipelines.$inferInsert;

export type SelectPipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;

export type SelectPipelineStageInstance = typeof pipelineStageInstances.$inferSelect;
export type InsertPipelineStageInstance = typeof pipelineStageInstances.$inferInsert;

export type SelectChangeRequest = typeof changeRequests.$inferSelect;
export type InsertChangeRequest = typeof changeRequests.$inferInsert;

export type SelectCapacitySnapshot = typeof capacitySnapshots.$inferSelect;
export type InsertCapacitySnapshot = typeof capacitySnapshots.$inferInsert;

export type SelectAgentJob = typeof agentJobs.$inferSelect;
export type InsertAgentJob = typeof agentJobs.$inferInsert;

export type SelectRisk = typeof risks.$inferSelect;
export type InsertRisk = typeof risks.$inferInsert;

export type SelectPostMortem = typeof postMortems.$inferSelect;
export type InsertPostMortem = typeof postMortems.$inferInsert;

export type SelectWeeklyReport = typeof weeklyReports.$inferSelect;
export type InsertWeeklyReport = typeof weeklyReports.$inferInsert;
