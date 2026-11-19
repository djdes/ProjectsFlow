import type { UserActivityRepository } from '../user/UserActivityRepository.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
// Bound for the in-memory throttle map; clearing it only costs a few extra writes.
const MAX_TRACKED = 10_000;

// Marks a user as seen at most once per interval per process: a request with a session
// otherwise costs no database write. Failures are logged, never thrown into the request.
export class LastSeenTracker {
  private readonly lastWrite = new Map<string, number>();

  constructor(
    private readonly repo: UserActivityRepository,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
  ) {}

  touch(userId: string, now: Date): void {
    const at = now.getTime();
    const previous = this.lastWrite.get(userId);
    if (previous !== undefined && at - previous < this.intervalMs) return;
    if (this.lastWrite.size >= MAX_TRACKED) this.lastWrite.clear();
    this.lastWrite.set(userId, at);
    this.repo.touchLastSeen(userId, now, new Date(at - this.intervalMs)).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[LastSeenTracker]', (err as Error).message);
    });
  }
}
