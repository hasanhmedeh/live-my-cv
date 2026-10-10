-- The Rally Trail's daily leaderboard: every run that crossed the line, timed, with the board day it
-- counts for (boards run from noon to noon, Beirut time). A new board just starts empty at 12:00:
-- nothing is ever deleted when it turns over.
CREATE TABLE "trail_runs" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "time_ms" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trail_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trail_runs_round_id_key" ON "trail_runs"("round_id");
CREATE INDEX "trail_runs_day_time_ms_idx" ON "trail_runs"("day", "time_ms");
CREATE INDEX "trail_runs_user_id_day_idx" ON "trail_runs"("user_id", "day");
CREATE INDEX "trail_runs_created_at_idx" ON "trail_runs"("created_at");

ALTER TABLE "trail_runs" ADD CONSTRAINT "trail_runs_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "ride_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trail_runs" ADD CONSTRAINT "trail_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Not modelled by Prisma: a run takes some time.
ALTER TABLE "trail_runs" ADD CONSTRAINT "trail_runs_time_ms_check" CHECK ("time_ms" > 0);

-- Every attraction has a settings row, so the office lists it (1 ticket a run, open).
INSERT INTO "attraction_settings" ("attraction", "tickets") VALUES ('trail', 1)
ON CONFLICT ("attraction") DO NOTHING;
