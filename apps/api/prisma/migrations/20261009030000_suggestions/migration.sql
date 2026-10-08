-- The Idea Box: members leave suggestions, staff answer each one once and move its status along.

-- CreateEnum
CREATE TYPE "suggestion_topic" AS ENUM ('attraction', 'shop', 'park', 'problem', 'other');

-- CreateEnum
CREATE TYPE "suggestion_status" AS ENUM ('pending', 'accepted', 'in_development', 'done', 'declined');

-- CreateTable
CREATE TABLE "suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic" "suggestion_topic" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "suggestion_status" NOT NULL DEFAULT 'pending',
    "status_changed_at" TIMESTAMP(3),
    "reply" TEXT,
    "replied_at" TIMESTAMP(3),
    "replied_by_id" TEXT,
    "replied_by_name" TEXT,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id"),
    -- Not modelled by Prisma: a suggestion and its answer say something, but not too much, and an
    -- answer always says when it was given.
    CONSTRAINT "suggestions_message_check" CHECK (char_length("message") BETWEEN 1 AND 500),
    CONSTRAINT "suggestions_reply_check" CHECK ("reply" IS NULL OR char_length("reply") BETWEEN 1 AND 500),
    CONSTRAINT "suggestions_replied_at_check" CHECK (("reply" IS NULL) = ("replied_at" IS NULL))
);

-- CreateIndex
CREATE INDEX "suggestions_user_id_created_at_idx" ON "suggestions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "suggestions_status_created_at_idx" ON "suggestions"("status", "created_at");

-- CreateIndex
CREATE INDEX "suggestions_created_at_idx" ON "suggestions"("created_at");

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_replied_by_id_fkey" FOREIGN KEY ("replied_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
