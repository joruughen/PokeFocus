CREATE TABLE "trade_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"offer_uid" text NOT NULL,
	"offer_snapshot" jsonb NOT NULL,
	"counter_uid" text,
	"counter_snapshot" jsonb,
	"message" text,
	"dust_cost" integer,
	"offer_evolved_to" text,
	"counter_evolved_to" text,
	"closed_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "trade_offers_not_self" CHECK ("trade_offers"."from_user_id" <> "trade_offers"."to_user_id"),
	CONSTRAINT "trade_offers_status_check" CHECK ("trade_offers"."status" in ('offered', 'countered', 'completed', 'rejected', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trade_offers" ADD CONSTRAINT "trade_offers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_offers" ADD CONSTRAINT "trade_offers_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_offers_from_idx" ON "trade_offers" USING btree ("from_user_id","status");--> statement-breakpoint
CREATE INDEX "trade_offers_to_idx" ON "trade_offers" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_offers_open_offer_uid_idx" ON "trade_offers" USING btree ("from_user_id","offer_uid") WHERE "trade_offers"."status" in ('offered', 'countered');--> statement-breakpoint
CREATE UNIQUE INDEX "trade_offers_open_counter_uid_idx" ON "trade_offers" USING btree ("to_user_id","counter_uid") WHERE "trade_offers"."status" = 'countered';--> statement-breakpoint
-- Friendships accepted before this migration: the request date is the best estimate of when they started.
UPDATE "friendships" SET "accepted_at" = "created_at" WHERE "status" = 'accepted' AND "accepted_at" IS NULL;