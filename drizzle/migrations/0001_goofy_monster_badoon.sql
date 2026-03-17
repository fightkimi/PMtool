CREATE TYPE "public"."agent_job_status" AS ENUM('pending', 'running', 'success', 'failed', 'vetoed');--> statement-breakpoint
CREATE TYPE "public"."agent_trigger" AS ENUM('scheduled', 'event', 'manual', 'agent_chain');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('zhongshui', 'zhongshu', 'menxia', 'shangshu', 'libu_li', 'libu_hu', 'libu_li2', 'libu_bing', 'libu_xing', 'libu_gong', 'capacity', 'postmortem');--> statement-breakpoint
CREATE TYPE "public"."change_request_source" AS ENUM('requirement', 'scope', 'resource', 'external');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('draft', 'evaluating', 'approved', 'rejected', 'implemented');--> statement-breakpoint
CREATE TYPE "public"."pipeline_business_type" AS ENUM('ui', 'skin', 'character', 'weapon', 'level', 'custom');--> statement-breakpoint
CREATE TYPE "public"."pipeline_complexity_tier" AS ENUM('s_plus', 's', 'a', 'b');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_status" AS ENUM('planning', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage_instance_status" AS ENUM('pending', 'active', 'blocked', 'review', 'done');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planning', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('game_dev', 'outsource', 'office_app', 'custom');--> statement-breakpoint
CREATE TYPE "public"."risk_detected_by" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."risk_status" AS ENUM('open', 'in_progress', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."task_department" AS ENUM('libu_li', 'libu_hu', 'libu_li2', 'libu_bing', 'libu_xing', 'libu_gong');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('pm', 'dev', 'qa', 'designer', 'manager');--> statement-breakpoint
CREATE TYPE "public"."workspace_plan" AS ENUM('free', 'pro', 'enterprise');--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_type" "agent_type" NOT NULL,
	"trigger" "agent_trigger" NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"status" "agent_job_status" DEFAULT 'pending' NOT NULL,
	"model_used" varchar(100),
	"tokens_input" integer DEFAULT 0 NOT NULL,
	"tokens_output" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capacity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"week_start" date NOT NULL,
	"role_type" varchar(50) NOT NULL,
	"user_id" uuid,
	"total_hours" numeric(6, 1) DEFAULT '40' NOT NULL,
	"allocated_hours" numeric(6, 1) DEFAULT '0' NOT NULL,
	"available_hours" numeric(6, 1) DEFAULT '40' NOT NULL,
	"project_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overload_flag" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" "change_request_source" NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"requested_by" uuid,
	"status" "change_request_status" DEFAULT 'draft' NOT NULL,
	"affected_task_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"affected_run_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"schedule_impact_days" integer DEFAULT 0 NOT NULL,
	"evaluation_by_agent" jsonb,
	"cascade_executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"complexity_tier" "pipeline_complexity_tier",
	"status" "pipeline_run_status" DEFAULT 'planning' NOT NULL,
	"planned_end" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"version_target" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_key" varchar(20) NOT NULL,
	"role_type" varchar(50) NOT NULL,
	"assignee_id" uuid,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"actual_start" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"float_days" numeric(5, 1),
	"status" "pipeline_stage_instance_status" DEFAULT 'pending' NOT NULL,
	"table_record_id" varchar(100),
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"business_type" "pipeline_business_type",
	"complexity_tier" "pipeline_complexity_tier",
	"milestone_anchors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_weeks_default" integer,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"historical_velocities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_system_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_mortems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"schedule_accuracy" numeric(5, 2),
	"estimate_accuracy" numeric(5, 2),
	"risk_hit_rate" numeric(5, 2),
	"velocity_by_role" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_request_count" integer DEFAULT 0 NOT NULL,
	"lessons_learned" text[] DEFAULT '{}'::text[] NOT NULL,
	"recommendations" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_mortems_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"level" "risk_level" NOT NULL,
	"description" text NOT NULL,
	"status" "risk_status" DEFAULT 'open' NOT NULL,
	"mitigation" text,
	"detected_by" "risk_detected_by" DEFAULT 'agent' NOT NULL,
	"table_record_id" varchar(100),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"assignee_id" uuid,
	"reviewer_id" uuid,
	"department" "task_department",
	"estimated_hours" numeric(5, 1),
	"actual_hours" numeric(5, 1),
	"earliest_start" timestamp with time zone,
	"latest_finish" timestamp with time zone,
	"float_days" numeric(5, 1),
	"github_issue_number" integer,
	"acceptance_criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"table_record_id" varchar(100),
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(200) NOT NULL,
	"role" "user_role" NOT NULL,
	"im_user_id" varchar(100),
	"work_hours_per_week" numeric(4, 1) DEFAULT '40' NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"plan" "workspace_plan" DEFAULT 'free' NOT NULL,
	"adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "name" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'planning'::"public"."project_status";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DATA TYPE "public"."project_status" USING "status"::"public"."project_status";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "type" "project_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pm_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "wecom_group_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "wecom_bot_webhook" varchar(500);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "wecom_mgmt_group_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "smart_table_root_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "task_table_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pipeline_table_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "capacity_table_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "risk_table_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "change_table_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo" varchar(200);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget" jsonb DEFAULT '{"total":0,"spent":0,"token_budget":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_snapshots" ADD CONSTRAINT "capacity_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_snapshots" ADD CONSTRAINT "capacity_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_instances" ADD CONSTRAINT "pipeline_stage_instances_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_instances" ADD CONSTRAINT "pipeline_stage_instances_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_instances" ADD CONSTRAINT "pipeline_stage_instances_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_mortems" ADD CONSTRAINT "post_mortems_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_pm_id_users_id_fk" FOREIGN KEY ("pm_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;