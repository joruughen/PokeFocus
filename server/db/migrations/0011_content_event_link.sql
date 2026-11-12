ALTER TABLE "content_versions" ADD COLUMN "linked_event_id" uuid;--> statement-breakpoint
ALTER TABLE "content_versions" ADD COLUMN "linked_role" text;--> statement-breakpoint
ALTER TABLE "content_versions" ADD COLUMN "revert_of_version_id" integer;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_linked_event_id_live_events_id_fk" FOREIGN KEY ("linked_event_id") REFERENCES "public"."live_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_versions_linked_event_idx" ON "content_versions" USING btree ("linked_event_id");--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_linked_role_check" CHECK ("content_versions"."linked_role" is null or "content_versions"."linked_role" in ('start', 'end'));