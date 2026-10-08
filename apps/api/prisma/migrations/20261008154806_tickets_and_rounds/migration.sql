-- Tickets, rounds and saved stats.
-- Hand-written so existing data survives: ride_tickets becomes ride_rounds instead of being dropped.

-- The enum covers every attraction that takes a ticket, so "ride" becomes "attraction" and gains the two games.
-- (The new values are not used later in this migration, which Postgres requires inside one transaction.)
ALTER TYPE "ride" RENAME TO "attraction";
ALTER TYPE "attraction" ADD VALUE 'crates';
ALTER TYPE "attraction" ADD VALUE 'striker';

-- Users: ticket balance, purchase cooldown and accepted terms.
ALTER TABLE "users" ADD COLUMN     "last_purchase_at" TIMESTAMP(3),
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT,
ADD COLUMN     "ticket_balance" INTEGER NOT NULL DEFAULT 0;

-- Not modelled by Prisma: a last line of defence behind the conditional decrement in the API.
ALTER TABLE "users" ADD CONSTRAINT "users_ticket_balance_check" CHECK ("ticket_balance" >= 0);

-- ride_tickets -> ride_rounds. Each old boarding becomes a round that cost nothing (boarding was free),
-- closed when it started, not completed and without stats.
ALTER TABLE "ride_tickets" RENAME TO "ride_rounds";
ALTER TABLE "ride_rounds" RENAME CONSTRAINT "ride_tickets_pkey" TO "ride_rounds_pkey";
ALTER TABLE "ride_rounds" RENAME CONSTRAINT "ride_tickets_user_id_fkey" TO "ride_rounds_user_id_fkey";
ALTER INDEX "ride_tickets_user_id_ride_idx" RENAME TO "ride_rounds_user_id_ride_idx";
ALTER TABLE "ride_rounds" RENAME COLUMN "created_at" TO "started_at";
ALTER TABLE "ride_rounds" ADD COLUMN     "tickets_spent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stats" JSONB;
ALTER TABLE "ride_rounds" ALTER COLUMN "tickets_spent" DROP DEFAULT;
UPDATE "ride_rounds" SET "ended_at" = "started_at";

-- CreateIndex
CREATE INDEX "ride_rounds_user_id_ended_at_idx" ON "ride_rounds"("user_id", "ended_at");

-- CreateTable
CREATE TABLE "ticket_purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_purchases_user_id_created_at_idx" ON "ticket_purchases"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ticket_purchases" ADD CONSTRAINT "ticket_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
