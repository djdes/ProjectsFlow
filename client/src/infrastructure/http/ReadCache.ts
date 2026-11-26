/**
 * Read cache for slowly changing resources — the project list, a project's settings, members
 * and site, workspaces, UI preferences — and for task lists.
 *
 * Every entry has two windows (see POLICIES):
 * - fresh: the answer comes from memory, no request at all;
 * - keep: past `fresh`, the old answer is still shown at once — on a screen's first frame
 *   (httpClient `peek`) and to readers that follow `pf:read-refreshed` (httpClient `swr`) — while
 *   a fresh copy loads in the background: no skeleton for data the app already knows. Other
 *   readers treat an expired entry as missing.
 *
 * Two kinds of change:
 * - own write: what it may have changed is dropped (WRITE_SCOPES) — the user never sees the copy
 *   from before their own change, not even the one saved on the device;
 * - a change made elsewhere (realtime events), or possibly missed (reconnect, back online): what
 *   it may have changed expires — strict readers go to the network, while screens keep showing
 *   the known answer until the fresh one arrives.
 * A logout or an expired session drops everything. Everything not listed in POLICIES — a task
 * itself, comments, unread marks, notifications, activity — is always read from the network.
 */

import { REFRESH_REQUESTED_EVENT } from '@/lib/readRefreshed';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

export type ReadPolicy = { readonly fresh: number; readonly keep: number };

const POLICIES: ReadonlyArray<readonly [RegExp, ReadPolicy]> = [
  // Task lists: fresh only long enough to make going back and forth between pages instant.
  [/^\/assignees\/(overview|mine|others|personal|approvals|awaiting-reply)$/, { fresh: 15 * SECOND, keep: DAY }],
  [/^\/projects\/[^/]+\/tasks$/, { fresh: 15 * SECOND, keep: DAY }],
  // The workspace's inbox project (read for its id and name) and the user's own preferences
  // practically never change.
  [/^\/inbox$/, { fresh: 10 * MINUTE, keep: 30 * DAY }],
  [/^\/me\/(ui-prefs|kanban-colors)$/, { fresh: 10 * MINUTE, keep: 30 * DAY }],
  [/^\/integrations\/github\/me$/, { fresh: 5 * MINUTE, keep: DAY }],
  [/^\/workspaces$/, { fresh: MINUTE, keep: 30 * DAY }],
  [/^\/workspaces\/[^/]+\/members$/, { fresh: MINUTE, keep: DAY }],
  // People of the workspace's projects: always re-read (pickers must see a removed colleague at
  // once), but known for a screen's first frame — the inbox people ribbon.
  [/^\/me\/shared-members$/, { fresh: 0, keep: DAY }],
  [/^\/projects$/, { fresh: MINUTE, keep: 30 * DAY }],
  [/^\/projects\/[^/]+$/, { fresh: MINUTE, keep: 30 * DAY }],
  [/^\/projects\/[^/]+\/(kanban-settings|members|templates|views)$/, { fresh: MINUTE, keep: 30 * DAY }],
  // Deploy state of the project's site changes when a worker publishes it.
  [/^\/projects\/[^/]+\/site$/, { fresh: 20 * SECOND, keep: DAY }],
];

export type PathMatch = (path: string) => boolean;

const EVERYTHING: PathMatch = () => true;
const exactly = (target: string): PathMatch => (path) => path === target;
const under = (prefix: string): PathMatch => (path) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Task lists, the inbox overview and the task counts shown with projects (projectId null —
 * every project's).
 */
function taskLists(projectId: string | null): PathMatch {
  return (path) =>
    path === '/projects' ||
    path.startsWith('/assignees/') ||
    (projectId === null
      ? /^\/projects\/[^/]+(\/tasks)?$/.test(path)
      : path === `/projects/${projectId}` || path === `/projects/${projectId}/tasks`);
}

// What an own write may change. A write not listed here may change anything.
const WRITE_SCOPES: ReadonlyArray<readonly [RegExp, (match: RegExpMatchArray) => PathMatch | null]> = [
  // Made while just looking around: no cached resource depends on them.
  [/^\/recent-task-views(\/|$)/, () => null],
  [/^\/notifications(\/|$)/, () => null],
  [/^\/workspaces\/[^/]+\/chat(\/|$)/, () => null],
  [/^\/push\//, () => null],
  [/^\/me\/(notification-prefs|telegram)(\/|$)/, () => null],
  // Own preferences and saved board views change only themselves.
  [/^\/me\/(ui-prefs|kanban-colors)$/, (m) => exactly(`/me/${m[1]}`)],
  [/^\/projects\/([^/]+)\/views(\/|$)/, (m) => under(`/projects/${m[1]}/views`)],
  // The order of the project list and the favourites.
  [/^\/projects\/(reorder|reorder-favorites)$/, () => exactly('/projects')],
  [/^\/projects\/([^/]+)\/favorite$/, (m) => (path) => path === '/projects' || path === `/projects/${m[1]}`],
  // A task and everything in it (comments, checklist, attachments, approval, commits): every
  // task list — a task may move to another project — and the counts shown with projects.
  [/^\/projects\/[^/]+\/tasks(\/|$)/, () => taskLists(null)],
];

export function readCachePolicy(path: string): ReadPolicy | null {
  if (path.includes('?')) return null;
  for (const [pattern, policy] of POLICIES) if (pattern.test(path)) return policy;
  return null;
}

/** How long a read is served from memory without a request (null — never cached). */
export function readCacheTtl(path: string): number | null {
  return readCachePolicy(path)?.fresh ?? null;
}

type Entry = {
  readonly path: string;
  readonly value: unknown;
  // The response body as received: compared with the next one to tell whether anything changed.
  readonly text: string | null;
  // When the request for it was sent (or the device copy was saved).
  readonly fetchedAt: number;
  // Monotonic cache-change sequence captured when a network request started (null for saved copies).
  readonly readSeq: number | null;
  readonly freshUntil: number;
  readonly keepUntil: number;
};

export type CacheHit = { readonly value: unknown; readonly stale: boolean; readonly text: string | null };

type Change = {
  readonly at: number;
  readonly seq: number;
  readonly kind: 'dropped' | 'expired';
  readonly matches: PathMatch;
};

export type StoreOptions = {
  /** Force the entry to be stored as stale (e.g. device copies on cold start must still revalidate). */
  readonly stale?: boolean;
};

// Expiries matter only to reads that were in flight across them (requests time out well before).
const EXPIRY_MEMORY = 2 * MINUTE;
// Own writes are remembered for the page's life (copies saved before one must not be shown);
// past this many, they merge into one «everything changed» at the latest time — stricter, never wrong.
const MAX_WRITES = 64;

export class ReadCache {
  private readonly entries = new Map<string, Entry>();
  private changes: Change[] = [];
  private seq = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    // Told about every drop and expiry (httpClient stops sharing reads already in flight and
    // drops matching device copies on own writes).
    private readonly onChange: (kind: 'dropped' | 'expired', matches: PathMatch) => void = () => undefined,
  ) {}

  /** Monotonic sequence of changes so far; captured before a network read starts. */
  currentSeq(): number {
    return this.seq;
  }

  /** The cached answer (a copy) and whether it is past its fresh window; undefined past `keep`. */
  lookup(key: string): CacheHit | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const now = this.now();
    if (entry.keepUntil <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // Callers may sort or edit what they get: every reader receives its own copy.
    return { value: structuredClone(entry.value), stale: entry.freshUntil <= now, text: entry.text };
  }

  /** A fresh answer (a copy), or undefined when there is none. */
  get(key: string): unknown {
    const hit = this.lookup(key);
    return hit && !hit.stale ? hit.value : undefined;
  }

  /** Whatever is known — fresh or kept — for a first render; undefined when nothing is. */
  peek(key: string): unknown {
    return this.lookup(key)?.value;
  }

  /**
   * Stores an answer obtained at `at` (the request was sent, or the device copy saved) unless a
   * newer one is already here or an own write since `at` (or since `readSeq` for live reads) may
   * have changed it. A change made elsewhere since `at`/`readSeq` stores it as already expired:
   * the answer may predate that change.
   * Returns whether it was stored.
   */
  store(
    key: string,
    path: string,
    value: unknown,
    policy: ReadPolicy,
    text: string | null = null,
    at = this.now(),
    readSeq?: number,
    options?: StoreOptions,
  ): boolean {
    const now = this.now();
    const keepUntil = at + policy.keep;
    if (keepUntil <= now) return false;
    const current = this.entries.get(key);
    if (current) {
      if (current.fetchedAt > at) return false;
      if (readSeq !== undefined && current.readSeq !== null && current.readSeq > readSeq) return false;
    }
    const change = this.changedSince(path, at, readSeq);
    if (change === 'dropped') return false;
    const freshUntil = options?.stale || change === 'expired' ? 0 : at + policy.fresh;
    this.entries.set(key, {
      path,
      value: structuredClone(value),
      text,
      fetchedAt: at,
      readSeq: readSeq ?? null,
      freshUntil,
      keepUntil,
    });
    return true;
  }

  /**
   * The strongest change to `path` since `time` (or strictly after `readSeq` when supplied):
   * 'dropped' (an own write — a copy from before it must not be shown), 'expired' (changed
   * elsewhere — showable, not fresh) or null.
   */
  changedSince(path: string, time: number, readSeq?: number): 'dropped' | 'expired' | null {
    let found: 'expired' | null = null;
    for (const change of this.changes) {
      const older = readSeq !== undefined ? change.seq <= readSeq : change.at < time;
      if (older || !change.matches(path)) continue;
      if (change.kind === 'dropped') return 'dropped';
      found = 'expired';
    }
    return found;
  }

  /** An own write (or a logout): drops what it may have changed. */
  drop(matches: PathMatch = EVERYTHING): void {
    for (const [key, entry] of this.entries) if (matches(entry.path)) this.entries.delete(key);
    this.remember('dropped', matches);
  }

  /** A change made elsewhere: what it may have changed stays showable but is no longer fresh. */
  expire(matches: PathMatch = EVERYTHING): void {
    for (const [key, entry] of this.entries) {
      if (matches(entry.path) && entry.freshUntil > 0) this.entries.set(key, { ...entry, freshUntil: 0 });
    }
    this.remember('expired', matches);
  }

  clear(): void {
    this.drop(EVERYTHING);
  }

  /** What a write to `path` may have changed is dropped. */
  afterWrite(path: string): void {
    const bare = path.split('?')[0]!;
    for (const [pattern, scope] of WRITE_SCOPES) {
      const match = bare.match(pattern);
      if (!match) continue;
      const matches = scope(match);
      if (matches) this.drop(matches);
      return;
    }
    this.drop(EVERYTHING);
  }

  /** Realtime and connectivity events that may carry changes made elsewhere. */
  listen(target: Pick<Window, 'addEventListener'>): void {
    const projectOf = (event: Event): string | null => {
      const id = (event as CustomEvent<{ projectId?: unknown }>).detail?.projectId;
      return typeof id === 'string' && id ? id : null;
    };
    // A task changed somewhere (by a colleague, a worker): its lists and counts.
    target.addEventListener('pf:task-changed', (event) => this.expire(taskLists(projectOf(event))));
    target.addEventListener('pf:notifications-changed', () => this.expire(taskLists(null)));
    target.addEventListener('pf:live-changed', (event) => {
      const projectId = projectOf(event);
      // A worker run moves tasks and may publish the project's site.
      this.expire(projectId ? (path) => taskLists(projectId)(path) || path === `/projects/${projectId}/site` : taskLists(null));
    });
    target.addEventListener('pf:project-site-published', (event) => {
      const projectId = projectOf(event);
      if (projectId) this.expire(exactly(`/projects/${projectId}/site`));
    });
    // Invites and members change in another tab too: the members panel echoes the change via
    // localStorage, and that tab's own write dropped only its own cache.
    target.addEventListener('pf:workspace-invites-changed', () => this.expire(under('/workspaces')));
    target.addEventListener('storage', (event) => {
      if ((event as StorageEvent).key === 'pf:workspace-invites-changed') this.expire(under('/workspaces'));
    });
    // A project's settings or members changed elsewhere; events may have been missed while
    // disconnected or offline; the user asked for the latest (pull to refresh).
    for (const name of ['pf:project-changed', 'pf:realtime-connected', 'online', REFRESH_REQUESTED_EVENT]) {
      target.addEventListener(name, () => this.expire());
    }
    target.addEventListener('pf:session-expired', () => this.drop());
  }

  private remember(kind: Change['kind'], matches: PathMatch): void {
    const at = this.now();
    const seq = ++this.seq;
    if (kind === 'dropped' && matches === EVERYTHING) {
      // Everything earlier is covered by this one.
      this.changes = [{ at, seq, kind, matches }];
    } else {
      this.changes = this.changes.filter((c) => c.kind === 'dropped' || c.at > at - EXPIRY_MEMORY);
      this.changes.push({ at, seq, kind, matches });
      if (this.changes.filter((c) => c.kind === 'dropped').length > MAX_WRITES) {
        this.changes = [{ at, seq, kind: 'dropped', matches: EVERYTHING }];
      }
    }
    this.onChange(kind, matches);
  }
}
