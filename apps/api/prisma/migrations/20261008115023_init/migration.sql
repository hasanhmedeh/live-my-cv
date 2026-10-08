-- CreateEnum
CREATE TYPE "ride" AS ENUM ('coaster', 'falcon', 'rocket', 'ferris', 'flip', 'ship', 'speedway', 'drone');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "username_key" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_tickets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ride" "ride" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key_key" ON "users"("username_key");

-- CreateIndex
CREATE INDEX "ride_tickets_user_id_ride_idx" ON "ride_tickets"("user_id", "ride");

-- AddForeignKey
ALTER TABLE "ride_tickets" ADD CONSTRAINT "ride_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
