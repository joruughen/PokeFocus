DROP INDEX "league_scores_rank_idx";--> statement-breakpoint
CREATE INDEX "users_country_idx" ON "users" USING btree ("country");--> statement-breakpoint
CREATE INDEX "league_scores_rank_idx" ON "league_scores" USING btree ("period","period_key","points" DESC NULLS LAST,"updated_at");