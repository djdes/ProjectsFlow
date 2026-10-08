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

  invalidate(): void {
    this.pending.clear();
  }
}
