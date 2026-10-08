-- Ticket prices, the ticket pack rules and the park's open/closed switch move into the database, so
-- they can be changed (in The Ringmaster's Office or Prisma Studio) without a deploy. Staff roles and
-- the log of what staff change come with them.

-- What one round of each attraction costs, in tickets.
CREATE TABLE "attraction_prices" (
    "attraction" "attraction" NOT NULL,
    "tickets" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attraction_prices_pkey" PRIMARY KEY ("attraction"),
    -- Not modelled by Prisma: a round always costs something.
    CONSTRAINT "attraction_prices_tickets_check" CHECK ("tickets" >= 1)
);

-- The prices the API used to hard-code: 5 for the two big rides, 1 for everything else.
INSERT INTO "attraction_prices" ("attraction", "tickets") VALUES
    ('coaster', 1),
    ('falcon', 5),
    ('rocket', 1),
    ('ferris', 5),
    ('flip', 1),
    ('ship', 1),
    ('speedway', 1),
    ('drone', 1),
    ('crates', 1),
    ('striker', 1);

-- The park's switches: one row, id 1. The pack rules default to the old constants: 20 tickets a
-- pack, one pack every 5 hours.
CREATE TABLE "park_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "closed_message" TEXT,
    "pack_size" INTEGER NOT NULL DEFAULT 20,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "park_settings_pkey" PRIMARY KEY ("id"),
    -- Not modelled by Prisma: there is only ever one settings row, and the pack rules stay sane.
    CONSTRAINT "park_settings_single_row" CHECK ("id" = 1),
    CONSTRAINT "park_settings_pack_size_check" CHECK ("pack_size" BETWEEN 1 AND 1000),
    CONSTRAINT "park_settings_cooldown_hours_check" CHECK ("cooldown_hours" BETWEEN 0 AND 168)
);

INSERT INTO "park_settings" ("id", "open") VALUES (1, true);

-- Staff: every existing account starts as a player; `pnpm staff:appoint <email>` makes an admin.
CREATE TYPE "role" AS ENUM ('player', 'admin');

ALTER TABLE "users" ADD COLUMN     "role" "role" NOT NULL DEFAULT 'player';

-- What staff changed, and when. The actor's username is copied in, so the log still reads right
-- after that account is deleted (actor_id then becomes null).
CREATE TABLE "admin_actions" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_actions_created_at_idx" ON "admin_actions"("created_at");

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
