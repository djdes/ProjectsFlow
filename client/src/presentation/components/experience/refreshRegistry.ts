type Reader = { scope: string; run: () => Promise<void> };
const readers = new Set<Reader>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;
const emit = (): void => {
  revision += 1;
  for (const listener of listeners) listener();
};
export const subscribeRefresh = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const refreshRevision = (): number => revision;
export const canRefreshPage = (scope: string): boolean =>
  [...readers].some((reader) => reader.scope === scope);
export const isRefreshingPage = (scope: string): boolean => pending.has(scope);
export function registerPageReader(
  scope: string,
  run: Reader['run'],
): () => void {
  const reader = { scope, run };
  readers.add(reader);
  emit();
  return () => {
    readers.delete(reader);
    emit();
  };
}
export function refreshPage(scope: string): Promise<void> {
  const existing = pending.get(scope);
  if (existing) return existing;
  const current = [...readers].filter((reader) => reader.scope === scope);
  if (!current.length) return Promise.resolve();
  // Schedule callbacks after registering pending, so simultaneous gestures share one run.
  const work = Promise.resolve()
    .then(async () => {
      const results = await Promise.allSettled(
        current.map((reader) => Promise.resolve().then(reader.run)),
      );
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Не удалось обновить данные. Попробуйте ещё раз.');
    })
    .finally(() => {
      pending.delete(scope);
      emit();
    });
  pending.set(scope, work);
  emit();
  return work;
}
