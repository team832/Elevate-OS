ALTER TABLE "core"."notifications" DROP CONSTRAINT "notifications_link_relative";--> statement-breakpoint
CREATE INDEX "placements_campaign_idx" ON "marketing"."placements" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "attempts_student_idx" ON "academic"."attempts" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "results_assessment_idx" ON "academic"."results" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "duplicate_flags_matched_idx" ON "ops"."duplicate_flags" USING btree ("matched_lead_id");--> statement-breakpoint
CREATE INDEX "demos_lead_idx" ON "ops"."demos" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "appointments_lead_idx" ON "ops"."appointments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "fee_records_lead_idx" ON "ops"."fee_records" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_link_relative" CHECK ("core"."notifications"."link" IS NULL OR ("core"."notifications"."link" ~ '^/([^/\\]|$)' AND "core"."notifications"."link" !~ '[[:cntrl:]]'));