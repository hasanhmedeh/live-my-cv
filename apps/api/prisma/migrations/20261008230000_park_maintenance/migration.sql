-- The park's maintenance mode, apart from closing it: closed lets visitors walk around without
-- boarding, while under maintenance keeps everyone but staff out of the fair altogether.
ALTER TABLE "park_settings" ADD COLUMN "under_maintenance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "maintenance_message" TEXT;
