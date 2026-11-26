import { AsyncLocalStorage } from 'node:async_hooks';

type Scope = {
  readonly values: Map<string, Promise<unknown>>;
  // False once the memo must stop serving (see requestMemoScope: the response has started).
  readonly active: () => boolean;
};

/**
 * Memo of read-only permission lookups that lives exactly one request (opened by the
 * requestMemoScope middleware). A list of N tasks asks "is the caller an admin", "is this
 * project hidden from them", "are they a member" once per task; a read request does not change
 * those answers, so the database is asked once per question.
 *
 * Outside a scope (background jobs, Telegram, MCP) and once the scope is no longer active,
 * every call reads. There is deliberately nothing shared between requests: a revoked session,
 * membership or admin flag takes effect on the very next request.
 */
export class RequestMemo {
  private readonly storage = new AsyncLocalStorage<Scope>();

  run(active: () => boolean, next: () => void): void {
    this.storage.run({ values: new Map(), active }, next);
  }

  memoize<T>(key: string, load: () => Promise<T>): Promise<T> {
    const scope = this.storage.getStore();
    if (!scope?.active()) return load();
    const known = scope.values.get(key);
    if (known) return known as Promise<T>;
    const value = load();
    scope.values.set(key, value);
    // A failed read is not remembered: the next caller asks the database again.
    value.catch(() => {
      if (scope.values.get(key) === value) scope.values.delete(key);
    });
    return value;
  }

  /** Returns a per-request value synchronously when inside an active GET scope, or null outside. */
  getOrCreateSync<T>(key: string, create: () => T): T | null {
    const scope = this.storage.getStore();
    if (!scope?.active()) return null;
    if (scope.values.has(key)) return scope.values.get(key) as unknown as T;
    const value = create();
    scope.values.set(key, value as unknown as Promise<unknown>);
    return value;
  }
}

// Memo key from its parts: JSON keeps ids that contain separators from colliding.
export function memoKey(...parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

// The admin-bypass resolver (configureAdminBypass): canManageTask and the access checks ask it
// for every task, so the flag is read once per request — and again on the next one.
export function requestScopedAdminCheck(
  memo: Pick<RequestMemo, 'memoize'>,
  users: { getById(userId: string): Promise<{ readonly isAdmin: boolean } | null> },
): (userId: string) => Promise<boolean> {
  return (userId) =>
    memo.memoize(memoKey('users.isAdmin', userId), async () => (await users.getById(userId))?.isAdmin ?? false);
}

/**
 * Deduplicates `countsByTasks` across parallel lists within a single GET request (e.g. the five
 * lists of `/api/assignees/overview`). Each unseen taskId is queried once; overlapping lists share
 * the in-flight promise without any timer or cross-request caching.
 */
export function requestScopedCountsByTasks(
  memo: Pick<RequestMemo, 'getOrCreateSync'>,
  kind: string,
  load: (taskIds: string[]) => Promise<ReadonlyMap<string, number>>,
): (taskIds: readonly string[]) => Promise<Map<string, number>> {
  const bucketKey = memoKey('countsByTasks', kind);
  return async (taskIds: readonly string[]): Promise<Map<string, number>> => {
    if (taskIds.length === 0) return new Map();
    const unique = [...new Set(taskIds)];
    const perTask = memo.getOrCreateSync<Map<string, Promise<number>>>(bucketKey, () => new Map());
    if (!perTask) return new Map(await load(unique));

    const missing = unique.filter((id) => !perTask.has(id));
    if (missing.length > 0) {
      const batch = load(missing);
      for (const id of missing) {
        const entry = batch.then((counts) => counts.get(id) ?? 0);
        perTask.set(id, entry);
        entry.catch(() => {
          if (perTask.get(id) === entry) perTask.delete(id);
        });
      }
    }
    const entries = await Promise.all(unique.map(async (id) => [id, await perTask.get(id)!] as const));
    const out = new Map<string, number>();
    for (const [id, count] of entries) {
      if (count > 0) out.set(id, count);
    }
    return out;
  };
}
