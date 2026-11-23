/** Shares concurrent reads only. Settled responses are never cached. */
export class InFlightReads {
  private readonly pending = new Map<string, Promise<unknown>>();

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const current = this.pending.get(key);
    if (current) return current as Promise<T>;
    const promise = Promise.resolve()
      .then(load)
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }

  /** Shares a read started elsewhere (a prefetch) with the readers that ask while it is in flight. */
  adopt<T>(key: string, promise: Promise<T>): void {
    if (this.pending.has(key)) return;
    const shared: Promise<unknown> = promise.finally(() => {
      if (this.pending.get(key) === shared) this.pending.delete(key);
    });
    // The reader handles failures; this copy only must not surface as unhandled.
    shared.catch(() => undefined);
    this.pending.set(key, shared);
  }

  invalidate(): void {
    this.pending.clear();
  }
}
