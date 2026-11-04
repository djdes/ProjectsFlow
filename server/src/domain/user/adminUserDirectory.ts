import type { PlanId } from '../usage/Plan.js';
import { effectivePlan, type Subscription } from '../usage/Subscription.js';

// Admin «Пользователи» console: search, one filter, sort and paging over the user list.
// Pure so the same rules are tested without a database. The list is small enough to be
// filtered in memory after one query; the API already takes page parameters, so moving the
// filtering into SQL later does not change the client.

export const ADMIN_USER_FILTERS = ['all', 'free', 'prime', 'vip', 'expired', 'admins', 'telegram', 'inactive', 'deleted'] as const;
export type AdminUserFilter = (typeof ADMIN_USER_FILTERS)[number];

export const ADMIN_USER_SORTS = ['name', 'created', 'activity', 'expiry'] as const;
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];

export const ADMIN_USER_PAGE_SIZE_MAX = 500;

export type AdminUserQuery = {
  readonly q: string;
  readonly filter: AdminUserFilter;
  // «Неактивные»: no activity for at least this many days (or never).
  readonly inactiveDays: number;
  readonly sort: AdminUserSort;
  readonly dir: 'asc' | 'desc';
  readonly page: number; // 1-based
  readonly pageSize: number;
};

export const DEFAULT_ADMIN_USER_QUERY: AdminUserQuery = {
  q: '', filter: 'all', inactiveDays: 30, sort: 'created', dir: 'desc', page: 1, pageSize: 50,
};

// The fields the rules need; the repository row carries more.
export type AdminDirectoryRow = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly telegramUsername: string | null;
  readonly isAdmin: boolean;
  readonly telegramLinked: boolean;
  readonly plan: PlanId;
  readonly subscriptionExpiresAt: Date | null;
  readonly lastActivityAt: Date | null;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
};

export type AdminUserPage<T> = {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  // How many users each filter would show with the current search.
  readonly counts: Readonly<Record<AdminUserFilter, number>>;
};

/** What the plan badge says: the paid plan, or «expired» once its term has passed. */
export function adminPlanState(row: Pick<AdminDirectoryRow, 'plan' | 'subscriptionExpiresAt'>, now: Date): PlanId | 'expired' {
  if (row.plan === 'free') return 'free';
  const sub: Subscription = { plan: row.plan, startedAt: null, expiresAt: row.subscriptionExpiresAt };
  return effectivePlan(sub, now) === 'free' ? 'expired' : row.plan;
}

function matchesSearch(row: AdminDirectoryRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().replace(/^@/, '');
  return row.displayName.toLowerCase().includes(needle)
    || row.email.toLowerCase().includes(needle)
    || (row.telegramUsername ?? '').toLowerCase().includes(needle);
}

function matchesFilter(row: AdminDirectoryRow, filter: AdminUserFilter, query: AdminUserQuery, now: Date): boolean {
  // Deleted accounts appear only under their own filter: they are anonymized leftovers.
  if (filter === 'deleted') return row.deletedAt !== null;
  if (row.deletedAt !== null) return false;
  switch (filter) {
    case 'all': return true;
    case 'free': case 'prime': case 'vip': case 'expired': return adminPlanState(row, now) === filter;
    case 'admins': return row.isAdmin;
    case 'telegram': return row.telegramLinked;
    case 'inactive': {
      const border = now.getTime() - query.inactiveDays * 24 * 60 * 60 * 1000;
      return row.lastActivityAt === null || row.lastActivityAt.getTime() < border;
    }
  }
}

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

// Rows without a value (never active, no paid term) are split off before this comparison.
function compare(a: AdminDirectoryRow, b: AdminDirectoryRow, sort: AdminUserSort): number {
  switch (sort) {
    case 'name': return collator.compare(a.displayName, b.displayName);
    case 'created': return a.createdAt.getTime() - b.createdAt.getTime();
    case 'activity': return (a.lastActivityAt?.getTime() ?? 0) - (b.lastActivityAt?.getTime() ?? 0);
    // Dated terms by date, unlimited grants after them.
    case 'expiry': return (a.subscriptionExpiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
      - (b.subscriptionExpiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  }
}

export function queryAdminUsers<T extends AdminDirectoryRow>(rows: readonly T[], query: AdminUserQuery, now: Date): AdminUserPage<T> {
  const searched = rows.filter((r) => matchesSearch(r, query.q.trim()));
  const counts = Object.fromEntries(ADMIN_USER_FILTERS.map((f) => [f, 0])) as Record<AdminUserFilter, number>;
  for (const row of searched) {
    for (const f of ADMIN_USER_FILTERS) if (matchesFilter(row, f, query, now)) counts[f]++;
  }
  const filtered = searched.filter((r) => matchesFilter(r, query.filter, query, now));
  const sign = query.dir === 'asc' ? 1 : -1;
  const isMissing = (r: T): boolean => query.sort === 'activity' ? r.lastActivityAt === null
    : query.sort === 'expiry' ? ['free', 'expired'].includes(adminPlanState(r, now)) : false;
  // Missing values go last in either direction.
  const sorted = [...filtered].sort((a, b) => {
    const ma = isMissing(a); const mb = isMissing(b);
    if (ma !== mb) return ma ? 1 : -1;
    const r = ma ? 0 : compare(a, b, query.sort);
    if (r !== 0) return r * sign;
    return collator.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id);
  });
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize)), ADMIN_USER_PAGE_SIZE_MAX);
  const lastPage = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page)), lastPage);
  return {
    items: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: sorted.length,
    page,
    pageSize,
    counts,
  };
}
