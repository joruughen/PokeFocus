CREATE TABLE "study_group_invites" (
	"group_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "study_group_invites_group_id_invitee_id_pk" PRIMARY KEY("group_id","invitee_id"),
	CONSTRAINT "study_group_invites_status_check" CHECK ("study_group_invites"."status" in ('pending', 'accepted', 'declined', 'joined', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "study_group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"left_reason" text,
	CONSTRAINT "study_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "study_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "study_groups_status_check" CHECK ("study_groups"."status" in ('lobby', 'started', 'ended'))
);
--> statement-breakpoint
ALTER TABLE "study_group_invites" ADD CONSTRAINT "study_group_invites_group_id_study_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."study_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_group_invites" ADD CONSTRAINT "study_group_invites_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_group_members" ADD CONSTRAINT "study_group_members_group_id_study_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."study_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_group_members" ADD CONSTRAINT "study_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_groups" ADD CONSTRAINT "study_groups_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_group_invites_invitee_idx" ON "study_group_invites" USING btree ("invitee_id","status");--> statement-breakpoint
CREATE INDEX "study_group_members_user_idx" ON "study_group_members" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "study_groups_host_idx" ON "study_groups" USING btree ("host_id");