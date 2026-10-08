import type { TransformFnParams } from 'class-transformer';

/** Free text from a form: trimmed, with runs of blank lines squeezed to one. Non-strings are left for the validators. */
export const tidyText = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : value;
