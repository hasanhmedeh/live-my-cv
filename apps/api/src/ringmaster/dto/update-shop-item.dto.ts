import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { TICKETS_RANGE } from '../../rides/attractions.js';

/** The most a shop item can be stocked with at once. */
export const STOCK_MAX = 100_000;

/** PATCH /ringmaster/shop/:item: its price, and how many are left. Left out means unchanged. */
export class UpdateShopItemDto {
  /** The price in tickets. Orders already made keep what they cost. */
  @IsOptional()
  @IsInt()
  @Min(TICKETS_RANGE.min)
  @Max(TICKETS_RANGE.max)
  tickets?: number;

  /** How many are left to sell: 0 is sold out, null is no limit. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX)
  stock?: number | null;
}
