-- Attractions can be closed one at a time, for maintenance, from The Ringmaster's Office: the
-- prices table becomes each attraction's settings (its price, and whether it is running).

ALTER TABLE "attraction_prices" RENAME TO "attraction_settings";
ALTER TABLE "attraction_settings" RENAME CONSTRAINT "attraction_prices_pkey" TO "attraction_settings_pkey";
ALTER TABLE "attraction_settings" RENAME CONSTRAINT "attraction_prices_tickets_check" TO "attraction_settings_tickets_check";

ALTER TABLE "attraction_settings" ADD COLUMN "open" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "closed_message" TEXT;

-- Every attraction has a row, so the office lists them all (the old seed already covered them).
INSERT INTO "attraction_settings" ("attraction", "tickets")
SELECT a, 1 FROM unnest(enum_range(NULL::"attraction")) AS a
ON CONFLICT ("attraction") DO NOTHING;

-- The office's analytics count signups, purchases and rounds per day across everyone.
CREATE INDEX "users_created_at_idx" ON "users"("created_at");
CREATE INDEX "ticket_purchases_created_at_idx" ON "ticket_purchases"("created_at");
CREATE INDEX "ride_rounds_started_at_idx" ON "ride_rounds"("started_at");
