import { startTransition, useEffect, useState } from 'react';

/**
 * False until the first frame showing `key` (a window opened on a task) has been painted, then
 * true — set in a transition, so React renders what waited without blocking input. A window
 * paints its frame first (header, title, properties) and mounts its heavy parts (an editor, a
 * discussion) right after, while it slides in: the tap answers at once instead of after them.
 */
export function useAfterFirstFrame(key: unknown): boolean {
  const [readyKey, setReadyKey] = useState<{ key: unknown } | null>(null);
  useEffect(() => {
    let second = 0;
    // The first callback runs before the frame is painted, the second after it.
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => startTransition(() => setReadyKey({ key })));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [key]);
  return readyKey !== null && Object.is(readyKey.key, key);
}
