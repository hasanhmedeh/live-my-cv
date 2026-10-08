import { IsBoolean } from 'class-validator';

/** PATCH /shop/souvenirs/:item: put it on, or take it off. */
export class WearDto {
  @IsBoolean()
  equipped!: boolean;
}
