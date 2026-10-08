-- Each shop item's price and stock, set in The Ringmaster's Office. No rows to start with: an item
-- without one sells at its catalog price (src/shop/catalog.ts), with no stock limit.

-- CreateTable
CREATE TABLE "shop_item_settings" (
    "item" TEXT NOT NULL,
    "tickets" INTEGER NOT NULL,
    "stock" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_item_settings_pkey" PRIMARY KEY ("item"),
    -- Not modelled by Prisma: an item always costs something, and the stock never goes below zero.
    CONSTRAINT "shop_item_settings_tickets_check" CHECK ("tickets" BETWEEN 1 AND 1000),
    CONSTRAINT "shop_item_settings_stock_check" CHECK ("stock" IS NULL OR "stock" >= 0)
);

-- The office counts what each item has sold.
CREATE INDEX "shop_orders_item_idx" ON "shop_orders"("item");
