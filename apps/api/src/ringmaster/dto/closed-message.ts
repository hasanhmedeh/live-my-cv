import type { TransformFnParams } from 'class-transformer';

/** A closed sign: trimmed, and blank means none (null, the default wording). Non-strings are left for the validators. */
export const closedMessage = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};
