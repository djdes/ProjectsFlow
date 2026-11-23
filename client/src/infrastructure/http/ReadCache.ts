/**
 * Short-lived cache for reads of slowly changing resources: the project list, a project's
 * settings, members and site, workspaces, UI preferences. The app re-reads them on every task
 * opening and page visit; within the TTL the answer comes from memory instead of the network.
 *
 * Task lists are kept only for 15 s — enough to make switching pages back and forth instant.
 *
 * Freshness: any write clears the cache (except the two writes that happen while merely
 * browsing — recording a task view and a board view — which clear only their own resource);
 * so do a realtime «project changed» event, a reconnect of the realtime stream, coming back
 * online, a logout or an expired session. Realtime task, worker and notification events drop
 * the task lists and the project list (task counts). Everything not listed in POLICIES — a
 * task itself, comments, unread marks, notifications, activity — is always read fresh.
 */

const SECOND = 1000;

const POLICIES: ReadonlyArray<readonly [RegExp, number]> = [
  // Task lists: only long enough to make going back and forth between pages instant. Any
  // write and any realtime task, worker or notification event drops them at once.
  [/^\/assignees\/(mine|others|personal|approvals|awaiting-reply)$/, 15 * SECOND],
  [/^\/projects\/[^/]+\/tasks$/, 15 * SECOND],
  [/^\/inbox$/, 60 * SECOND],
  [/^\/me\/(ui-prefs|kanban-colors)$/, 5 * 60 * SECOND],
  [/^\/integrations\/github\/me$/, 5 * 60 * SECOND],
  [/^\/workspaces$/, 60 * SECOND],
  [/^\/workspaces\/[^/]+\/members$/, 60 * SECOND],
  [/^\/projects$/, 60 * SECOND],
  [/^\/projects\/[^/]+$/, 60 * SECOND],
  [/^\/projects\/[^/]+\/(kanban-settings|members|templates|views)$/, 60 * SECOND],
  // Deploy state of the project's site changes when a worker publishes it.
  [/^\/projects\/[^/]+\/site$/, 20 * SECOND],
];

// Writes that happen while just looking around: they must not throw the whole cache away.
const SCOPED_WRITES: ReadonlyArray<readonly [RegExp, (match: RegExpMatchArray) => string | null]> = [
  [/^\/recent-task-views(\/|$)/, () => null],
  [/^\/projects\/([^/]+)\/views$/, (m) => `/projects/${m[1]}/views`],
  [/^\/me\/(ui-prefs|kanban-colors)$/, (m) => `/me/${m[1]}`],
];

export function readCacheTtl(path: string): number | null {
  if (path.includes('?')) return null;
  for (const [pattern, ttl] of POLICIES) if (pattern.test(path)) return ttl;
  return null;
}

type Entry = { readonly path: string; readonly value: unknown; readonly until: number };

export class ReadCache {
  private readonly entries = new Map<string, Entry>();
  // Bumped on every invalidation: a read that was in flight across one may carry data from
  // before the change and must not be stored.
  private generationValue = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get generation(): number {
    return this.generationValue;
  }

  /** A copy of the cached answer, or undefined when there is none (or it has expired). */
  get(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.until <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Callers may sort or edit what they get: every reader receives its own copy.
    return structuredClone(entry.value);
  }

  set(key: string, path: string, value: unknown, ttlMs: number): void {
    this.entries.set(key, { path, value: structuredClone(value), until: this.now() + ttlMs });
  }

  /** Drops the cached reads of `path` and of everything under it. */
  forget(path: string): void {
    this.generationValue += 1;
    for (const [key, entry] of this.entries) {
      if (entry.path === path || entry.path.startsWith(`${path}/`)) this.entries.delete(key);
    }
  }

  /** Drops the cached reads whose path matches. */
  forgetWhere(matches: (path: string) => boolean): void {
    this.generationValue += 1;
    for (const [key, entry] of this.entries) if (matches(entry.path)) this.entries.delete(key);
  }

  /** Drops exactly the cached reads of `path`. */
  forgetExact(path: string): void {
    this.generationValue += 1;
    for (const [key, entry] of this.entries) if (entry.path === path) this.entries.delete(key);
  }

  clear(): void {
    this.generationValue += 1;
    this.entries.clear();
  }

  /** What a successful write to `path` makes stale. */
  afterWrite(path: string): void {
    const bare = path.split('?')[0]!;
    for (const [pattern, scope] of SCOPED_WRITES) {
      const match = bare.match(pattern);
      if (!match) continue;
      const target = scope(match);
      if (target) this.forget(target);
      return;
    }
    this.clear();
  }

  /** Realtime and connectivity events that may carry changes made elsewhere. */
  listen(target: Pick<Window, 'addEventListener'>): void {
    const projectOf = (event: Event): string | null => {
      const id = (event as CustomEvent<{ projectId?: unknown }>).detail?.projectId;
      return typeof id === 'string' && id ? id : null;
    };
    // A task changed somewhere (by a colleague, a worker): lists, counts and the project's
    // card in the list are stale. Without a project id — every project's lists.
    const forgetTaskLists = (projectId: string | null): void => {
      this.forgetExact('/projects');
      this.forget('/assignees');
      if (projectId) {
        this.forgetExact(`/projects/${projectId}`);
        this.forget(`/projects/${projectId}/tasks`);
      } else {
        this.forgetWhere((path) => /^\/projects\/[^/]+(\/tasks)?$/.test(path));
      }
    };
    target.addEventListener('pf:task-changed', (event) => forgetTaskLists(projectOf(event)));
    target.addEventListener('pf:notifications-changed', () => forgetTaskLists(null));
    target.addEventListener('pf:live-changed', (event) => {
      const projectId = projectOf(event);
      forgetTaskLists(projectId);
      if (projectId) this.forget(`/projects/${projectId}/site`);
    });
    target.addEventListener('pf:project-site-published', (event) => {
      const projectId = projectOf(event);
      if (projectId) this.forget(`/projects/${projectId}/site`);
    });
    // Invites and members change in another tab too: the members panel echoes the change via
    // localStorage, and that tab's own write cleared only its own cache.
    target.addEventListener('pf:workspace-invites-changed', () => this.forget('/workspaces'));
    target.addEventListener('storage', (event) => {
      if ((event as StorageEvent).key === 'pf:workspace-invites-changed') this.forget('/workspaces');
    });
    for (const name of ['pf:project-changed', 'pf:realtime-connected', 'pf:session-expired', 'online']) {
      target.addEventListener(name, () => this.clear());
    }
  }
}
