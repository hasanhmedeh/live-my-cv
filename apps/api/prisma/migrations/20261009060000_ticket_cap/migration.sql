-- A ceiling on free tickets: a pack only tops the balance up to it (40 held under a cap of 45 gets
-- 5), and a member already at it gets nothing. Null means no ceiling, as before.
ALTER TABLE "park_settings" ADD COLUMN "ticket_cap" INTEGER;
ALTER TABLE "park_settings" ADD CONSTRAINT "park_settings_ticket_cap_check" CHECK ("ticket_cap" IS NULL OR "ticket_cap" BETWEEN 1 AND 100000);
