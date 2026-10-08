import type { TicketPurchase } from '../generated/prisma/client.js';

/** A purchase as the web client sees it. */
export interface PurchaseJson {
  id: string;
  quantity: number;
  priceCents: number;
  currency: string;
  balanceAfter: number;
  createdAt: string;
}

export function toPurchaseJson(purchase: TicketPurchase): PurchaseJson {
  return {
    id: purchase.id,
    quantity: purchase.quantity,
    priceCents: purchase.priceCents,
    currency: purchase.currency,
    balanceAfter: purchase.balanceAfter,
    createdAt: purchase.createdAt.toISOString(),
  };
}
