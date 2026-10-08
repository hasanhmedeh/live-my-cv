import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { Attraction } from '../generated/prisma/client.js';
import { ATTRACTIONS } from './attractions.js';

/** Accepts an attraction id from the URL, or answers 400 listing the valid ones. */
@Injectable()
export class ParseRidePipe implements PipeTransform<string, Attraction> {
  transform(value: string): Attraction {
    if ((ATTRACTIONS as string[]).includes(value)) return value as Attraction;
    throw new BadRequestException(`Unknown ride. Expected one of: ${ATTRACTIONS.join(', ')}`);
  }
}
