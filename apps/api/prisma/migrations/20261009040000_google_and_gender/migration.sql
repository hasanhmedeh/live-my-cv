-- Continue with Google, and gender at signup. Accounts made with Google have no password; older
-- accounts have no gender until they're asked for it after logging in.

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('female', 'male', 'other', 'prefer_not_to_say');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL,
ADD COLUMN "google_id" TEXT,
ADD COLUMN "gender" "gender";

-- Not modelled by Prisma: every account has a way to sign in, a password or Google.
ALTER TABLE "users" ADD CONSTRAINT "users_sign_in_check" CHECK ("password_hash" IS NOT NULL OR "google_id" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
