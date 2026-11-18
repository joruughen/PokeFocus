CREATE TABLE "group_heals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"pokemon_uid" text NOT NULL,
	"species_slug" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "group_heals_not_self" CHECK ("group_heals"."from_user_id" <> "group_heals"."to_user_id"),
	CONSTRAINT "group_heals_status_check" CHECK ("group_heals"."status" in ('pending', 'accepted', 'declined', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "group_heals" ADD CONSTRAINT "group_heals_group_id_study_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."study_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_heals" ADD CONSTRAINT "group_heals_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_heals" ADD CONSTRAINT "group_heals_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_heals_to_idx" ON "group_heals" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE INDEX "group_heals_group_from_idx" ON "group_heals" USING btree ("group_id","from_user_id");