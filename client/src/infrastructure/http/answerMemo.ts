import type { Answer } from './httpClient';

/**
 * Builds a value from an answer and hands out the one built last time while the body is the
 * same: a screen re-reading unchanged data gets the very same objects, so React skips the
 * re-render (state setters bail out on an identical value). Readers must not mutate what they
 * get — it is shared with the next reader.
 */
export function memoByAnswer<T, R>(build: (data: T) => R): (answer: Answer<T>) => R {
  let last: { readonly text: string; readonly value: R } | null = null;
  return (answer) => {
    if (answer.text !== null && last !== null && last.text === answer.text) return last.value;
    const value = build(answer.data);
    last = answer.text === null ? null : { text: answer.text, value };
    return value;
  };
}
