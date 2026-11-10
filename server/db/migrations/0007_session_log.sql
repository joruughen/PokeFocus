CREATE TABLE "session_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"minutes" double precision NOT NULL,
	"focus" double precision NOT NULL,
	"late_claim" boolean DEFAULT false NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"wilds" integer DEFAULT 0 NOT NULL,
	"catches" integer DEFAULT 0 NOT NULL,
	"shinies" integer DEFAULT 0 NOT NULL,
	"legendaries" integer DEFAULT 0 NOT NULL,
	"content_hash" text
);
--> statement-breakpoint
ALTER TABLE "session_log" ADD CONSTRAINT "session_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_log_user_session_idx" ON "session_log" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "session_log_ended_idx" ON "session_log" USING btree ("ended_at");