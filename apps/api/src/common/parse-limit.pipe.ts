import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/**
 * A `?limit=` query parameter: absent means `fallback`, anything but a positive whole number is a 400,
 * and values above `max` are capped rather than refused.
 */
@Injectable()
export class ParseLimitPipe implements PipeTransform<string | undefined, number> {
  constructor(
    private readonly fallback: number,
    private readonly max: number,
  ) {}

  transform(value: string | undefined): number {
    if (value === undefined || value === '') return this.fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1) throw new BadRequestException('limit must be a positive whole number');
    return Math.min(Number(value), this.max);
  }
}
