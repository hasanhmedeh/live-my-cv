import { Attraction } from '../generated/prisma/client.js';

/**
 * The ticket rules, in one place. The web client reads them from GET /api/tickets rather than
 * keeping its own copy.
 */

/** Every attraction id, in the order of the Attraction enum in prisma/schema.prisma. */
export const ATTRACTIONS = Object.values(Attraction);

/** Tickets one round costs. Typed against the enum, so a new attraction can't be left without a price. */
export const TICKET_COSTS: Readonly<Record<Attraction, number>> = {
  coaster: 1,
  falcon: 5,
  rocket: 1,
  ferris: 5,
  flip: 1,
  ship: 1,
  speedway: 1,
  drone: 1,
  crates: 1,
  striker: 1,
};

/** Tickets in one pack. A purchase adds a pack to whatever is left. */
export const PACK_SIZE = 20;

/** Hours between two purchases, counted from the last one. */
export const COOLDOWN_HOURS = 5;
export const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

/** What purchases are recorded as while tickets are free. */
export const PACK_PRICE_CENTS = 0;
export const PACK_CURRENCY = 'EUR';
export const PACK_PROVIDER = 'free';
