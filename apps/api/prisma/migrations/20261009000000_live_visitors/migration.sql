-- Who's in the fair right now, for The Ringmaster's Office: one row per open game tab, kept fresh
-- while its live stream is connected (any API instance), and counted while seen in the last minute.
CREATE TABLE "live_visitors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "in_fair" BOOLEAN NOT NULL,
    "stream" TEXT NOT NULL,
    "gone" BOOLEAN NOT NULL DEFAULT false,
    "seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_visitors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "live_visitors_seen_at_idx" ON "live_visitors"("seen_at");
