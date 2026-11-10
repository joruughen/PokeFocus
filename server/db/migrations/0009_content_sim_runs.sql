CREATE TABLE "content_sim_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer,
	"draft_hash" text NOT NULL,
	"active_version_id" integer,
	"active_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"params" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "content_sim_runs_status_check" CHECK ("content_sim_runs"."status" in ('running', 'done', 'failed', 'timeout', 'interrupted'))
);
--> statement-breakpoint
ALTER TABLE "content_sim_runs" ADD CONSTRAINT "content_sim_runs_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sim_runs" ADD CONSTRAINT "content_sim_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_sim_runs_version_idx" ON "content_sim_runs" USING btree ("version_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_sim_runs_created_idx" ON "content_sim_runs" USING btree ("created_at" DESC NULLS LAST);