import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { statsProblem, type Stats } from '../stats.js';

/** class-validator has no rule for "object with arbitrary keys and number values", so this is one. */
@ValidatorConstraint({ name: 'isStats' })
export class IsStatsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return statsProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} ${statsProblem(args.value) ?? 'is invalid'}`;
  }
}

export class FinishRoundDto {
  /** True when the round ran to its end, false when the player left early. */
  @IsBoolean()
  completed: boolean;

  /** Optional: left out (or null) means {}. */
  // Validate the body exactly as parsed: class-transformer would otherwise copy the object first.
  @Transform(({ obj }: TransformFnParams) => (obj as { stats?: unknown }).stats)
  @IsOptional()
  @Validate(IsStatsConstraint)
  stats?: Stats;
}
