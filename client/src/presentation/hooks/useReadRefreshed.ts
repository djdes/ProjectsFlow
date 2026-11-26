import { useEffect, useRef } from 'react';
import { onReadRefreshed, type ReadRefreshTopic } from '@/lib/readRefreshed';

/**
 * The screen showed a kept answer and a fresher one has arrived (lib/readRefreshed): re-read —
 * from memory now — and update in place, without a skeleton. For screens whose reads allow a
 * kept answer (repository methods documented as such). Optional `topics` restricts wakeups to
 * relevant resource groups so unrelated background refreshes don't churn other screens.
 */
export function useReadRefreshed(
  onRefreshed: () => void,
  topics?: readonly ReadRefreshTopic[],
): void {
  const callback = useRef(onRefreshed);
  useEffect(() => {
    callback.current = onRefreshed;
  });
  const topicKey = topics ? topics.join(',') : '';
  useEffect(() => {
    const filter = topicKey ? (topicKey.split(',') as ReadRefreshTopic[]) : undefined;
    return onReadRefreshed(() => callback.current(), filter);
  }, [topicKey]);
}
