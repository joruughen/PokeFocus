CREATE TABLE "content_snapshots" (
	"hash" text PRIMARY KEY NOT NULL,
	"base_hash" text NOT NULL,
	"version_id" integer,
	"event_revs" jsonb NOT NULL,
	"resolved" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"patch" jsonb NOT NULL,
	"base_hash" text,
	"hash" text,
	"parent_id" integer,
	"title" text,
	"note" text,
	"effective_at" timestamp with time zone,
	"validation" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "content_versions_status_check" CHECK ("content_versions"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_versions_status_effective_idx" ON "content_versions" USING btree ("status","effective_at");