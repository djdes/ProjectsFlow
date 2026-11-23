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
