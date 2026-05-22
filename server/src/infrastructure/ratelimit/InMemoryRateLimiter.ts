// Простой in-memory fixed-window rate-limiter. Состояние в памяти процесса (PM2 single
// instance) — при рестарте сбрасывается, что приемлемо для анти-абьюза. Не для биллинга.

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  // true — запрос разрешён; false — лимит превышен в текущем окне.
  hit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (b.count >= limit) return false;
    b.count += 1;
    return true;
  }

  // Периодическая очистка протухших корзин (вызывается по таймеру в композиции).
  pruneExpired(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now >= b.resetAt) this.buckets.delete(k);
  }
}
