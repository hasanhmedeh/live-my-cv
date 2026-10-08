-- The Ticket Booth's shop: treats and souvenirs bought with tickets (see src/shop/catalog.ts).

-- CreateTable
CREATE TABLE "shop_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "tickets_spent" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "souvenirs" (
    "user_id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "equipped" BOOLEAN NOT NULL DEFAULT true,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "souvenirs_pkey" PRIMARY KEY ("user_id","item")
);

-- CreateIndex
CREATE INDEX "shop_orders_user_id_created_at_idx" ON "shop_orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "shop_orders_created_at_idx" ON "shop_orders"("created_at");

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "souvenirs" ADD CONSTRAINT "souvenirs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

