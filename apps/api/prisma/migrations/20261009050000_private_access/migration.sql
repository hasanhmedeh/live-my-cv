-- Private access: while it's on, only the addresses in allowed_ips can reach the site (the pages and
-- the API alike). Off by default, so nothing changes until staff switch it on.
ALTER TABLE "park_settings" ADD COLUMN "allowlist_only" BOOLEAN NOT NULL DEFAULT false;

-- An address or a CIDR range, whose it is, and who let it in.
CREATE TABLE "allowed_ips" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "label" TEXT,
    "added_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowed_ips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowed_ips_ip_key" ON "allowed_ips"("ip");
