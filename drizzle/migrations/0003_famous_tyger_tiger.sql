ALTER TABLE "projects" RENAME COLUMN "task_table_id" TO "task_table_webhook";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "pipeline_table_id" TO "pipeline_table_webhook";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "capacity_table_id" TO "capacity_table_webhook";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "risk_table_id" TO "risk_table_webhook";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "change_table_id" TO "change_table_webhook";