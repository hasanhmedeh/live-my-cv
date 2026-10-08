import { IsString, MaxLength } from 'class-validator';

/** POST /shop/buy: one item from the catalog, by its id. */
export class BuyDto {
  @IsString()
  @MaxLength(40)
  item!: string;
}
