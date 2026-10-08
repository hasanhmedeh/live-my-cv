import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/** A `?offset=` query parameter for paging: absent means 0, anything but a whole number is a 400. */
@Injectable()
export class ParseOffsetPipe implements PipeTransform<string | undefined, number> {
  transform(value: string | undefined): number {
    if (value === undefined || value === '') return 0;
    if (!/^\d{1,9}$/.test(value)) throw new BadRequestException('offset must be a whole number');
    return Number(value);
  }
}
