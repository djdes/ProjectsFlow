import { useEffect, useRef } from 'react';
import { onReadRefreshed } from '@/lib/readRefreshed';

/**
 * The screen showed a kept answer and a fresher one has arrived (lib/readRefreshed): re-read —
 * from memory now — and update in place, without a skeleton. For screens whose reads allow a
 * kept answer (repository methods documented as such).
 */
export function useReadRefreshed(onRefreshed: () => void): void {
  const callback = useRef(onRefreshed);
  useEffect(() => {
    callback.current = onRefreshed;
  });
  useEffect(() => onReadRefreshed(() => callback.current()), []);
}
