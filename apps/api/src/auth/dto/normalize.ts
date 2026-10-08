import type { TransformFnParams } from 'class-transformer';

// Leave non-strings alone so the validators report them instead of crashing here.

export const trim = ({ value }: TransformFnParams): unknown => (typeof value === 'string' ? value.trim() : value);

export const normalizeEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
