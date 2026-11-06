ALTER TABLE "users" ADD COLUMN "trainer_name_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "country_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymous_rankings" boolean DEFAULT false NOT NULL;