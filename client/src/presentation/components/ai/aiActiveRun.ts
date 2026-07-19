import { useSyncExternalStore } from 'react';

/**
 * Композер живёт рядом с лентой, но не владеет сообщениями: статус рана знает только
 * `useAiConversation`. Держим id активного рана в модульном сторе, чтобы не поднимать
 * второй SSE-поток ради кнопки «Стоп».
 */
const activeRuns = new Map<string, string>();
const listeners = new Set<() => void>();

export function publishAiActiveRun(conversationId: string, runId: string | null): void {
  const current = activeRuns.get(conversationId) ?? null;
  if (current === runId) return;
  if (runId) activeRuns.set(conversationId, runId);
  else activeRuns.delete(conversationId);
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAiActiveRunId(conversationId: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (conversationId ? activeRuns.get(conversationId) ?? null : null),
    () => null,
  );
}
