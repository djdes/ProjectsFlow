import {
  ADMIN_USER_FILTERS,
  ADMIN_USER_SORTS,
  type AdminAuditEntry,
  type AdminUser,
  type AdminUserFilter,
  type AdminUserListQuery,
  type AdminUserSort,
} from '@/application/admin/AdminRepository';
import { pluralRu } from '@/presentation/components/admin/mailing/mailingFormat';

// URL state of the «Пользователи» console: /admin?tab=users&q=…&f=…&sort=…&dir=…&page=…&user=…
// Defaults are left out of the URL so a plain /admin?tab=users stays the canonical link.

export type ConsoleState = Omit<AdminUserListQuery, 'pageSize'>;

export const CONSOLE_PAGE_SIZE = 50;
export const INACTIVE_DAY_OPTIONS = [7, 30, 90] as const;

export const DEFAULT_CONSOLE_STATE: ConsoleState = {
  q: '', filter: 'all', inactiveDays: 30, sort: 'created', dir: 'desc', page: 1,
};

// Each sort has the direction people expect first: names A→Я, dates newest first,
// plan terms soonest first.
export const DEFAULT_SORT_DIR: Record<AdminUserSort, 'asc' | 'desc'> = {
  name: 'asc', created: 'desc', activity: 'desc', expiry: 'asc',
};

export const FILTER_LABEL: Record<AdminUserFilter, string> = {
  all: 'Все', free: 'Бесплатный', prime: 'Прайм', vip: 'VIP', expired: 'Срок истёк',
  admins: 'Админы', telegram: 'С Telegram', inactive: 'Неактивные', deleted: 'Удалённые',
};

export const SORT_LABEL: Record<AdminUserSort, string> = {
  name: 'Имя', created: 'Регистрация', activity: 'Активность', expiry: 'Окончание тарифа',
};

const KEYS = { q: 'q', filter: 'f', inactiveDays: 'idle', sort: 'sort', dir: 'dir', page: 'page' } as const;

function positiveInt(raw: string | null, fallback: number, max: number): number {
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}

export function parseConsoleState(params: URLSearchParams): ConsoleState {
  const filter = params.get(KEYS.filter);
  const sort = params.get(KEYS.sort);
  const parsedSort = (ADMIN_USER_SORTS as readonly string[]).includes(sort ?? '') ? (sort as AdminUserSort) : DEFAULT_CONSOLE_STATE.sort;
  const dir = params.get(KEYS.dir);
  return {
    q: (params.get(KEYS.q) ?? '').slice(0, 200),
    filter: (ADMIN_USER_FILTERS as readonly string[]).includes(filter ?? '') ? (filter as AdminUserFilter) : 'all',
    inactiveDays: positiveInt(params.get(KEYS.inactiveDays), DEFAULT_CONSOLE_STATE.inactiveDays, 3650),
    sort: parsedSort,
    dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_SORT_DIR[parsedSort],
    page: positiveInt(params.get(KEYS.page), 1, 100_000),
  };
}

/** Writes the state into a copy of params; other keys (tab, user) are kept. */
export function writeConsoleState(params: URLSearchParams, state: ConsoleState): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string, fallback: string): void => {
    if (value === fallback) next.delete(key); else next.set(key, value);
  };
  set(KEYS.q, state.q, '');
  set(KEYS.filter, state.filter, 'all');
  set(KEYS.inactiveDays, String(state.inactiveDays), String(DEFAULT_CONSOLE_STATE.inactiveDays));
  set(KEYS.sort, state.sort, DEFAULT_CONSOLE_STATE.sort);
  set(KEYS.dir, state.dir, DEFAULT_SORT_DIR[state.sort]);
  set(KEYS.page, String(state.page), '1');
  return next;
}

/** A change to search, filter or sort starts from the first page. */
export function updateConsoleState(state: ConsoleState, patch: Partial<ConsoleState>): ConsoleState {
  const next = { ...state, ...patch };
  if (patch.sort && patch.sort !== state.sort && patch.dir === undefined) next.dir = DEFAULT_SORT_DIR[patch.sort];
  const resetsPage = (['q', 'filter', 'inactiveDays', 'sort', 'dir'] as const).some((k) => k in patch && patch[k] !== state[k]);
  if (resetsPage && patch.page === undefined) next.page = 1;
  return next;
}

export function toListQuery(state: ConsoleState, pageSize = CONSOLE_PAGE_SIZE): AdminUserListQuery {
  return { ...state, q: state.q.trim(), pageSize };
}

const DAY_MS = 86_400_000;

export type PlanBadge = { readonly label: string; readonly tone: string; readonly title: string };

const dateRu = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Plan badge: tone by plan, «истёк» once the term is over, days left when under a week. */
export function planBadge(user: Pick<AdminUser, 'plan' | 'subscriptionExpiresAt'>, now: number): PlanBadge {
  if (user.plan === 'free') return { label: 'Free', tone: 'pf-tone-gray', title: 'Бесплатный тариф' };
  const name = user.plan === 'vip' ? 'VIP' : 'Прайм';
  const tone = user.plan === 'vip' ? 'pf-tone-purple' : 'pf-tone-yellow';
  if (!user.subscriptionExpiresAt) return { label: `${name} · бессрочно`, tone, title: `${name} без срока окончания` };
  const end = Date.parse(user.subscriptionExpiresAt);
  if (end <= now) return { label: `${name} · истёк`, tone: 'pf-tone-red', title: `${name} закончился ${dateRu(user.subscriptionExpiresAt)}` };
  const days = Math.ceil((end - now) / DAY_MS);
  const left = days <= 7 ? ` · ${days} ${pluralRu(days, 'день', 'дня', 'дней')}` : ` до ${dateRu(user.subscriptionExpiresAt)}`;
  return { label: `${name}${left}`, tone, title: `${name} до ${dateRu(user.subscriptionExpiresAt)}` };
}

/** «5 мин назад» for recent moments, a date for older ones, «нет данных» when unknown. */
export function activityText(iso: string | null, now: number): string {
  if (!iso) return 'нет данных';
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`;
  return dateRu(iso);
}

export const shortDate = (iso: string): string => dateRu(iso);

const csvCell = (value: string | number | boolean | null): string => {
  const text = value === null ? '' : String(value);
  // Spreadsheet formula injection: a leading = + - @ is neutralized with a quote.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// Byte order mark: Excel opens UTF-8 CSV correctly only with it.
const BOM = String.fromCharCode(0xfeff);

/** CSV for Excel/Sheets: UTF-8 with BOM, semicolon separator (ru locale default). */
export function usersToCsv(users: readonly AdminUser[]): string {
  const header = ['Имя', 'Почта', 'Тариф', 'Окончание тарифа', 'Админ', 'Telegram', 'Проекты', 'Пространства',
    'Регистрация', 'Последний вход', 'Последняя активность'];
  const rows = users.map((u) => [
    u.displayName, u.email, u.plan, u.subscriptionExpiresAt, u.isAdmin ? 'да' : 'нет',
    u.telegramLinked ? (u.telegramUsername ?? 'да') : '', u.projectCount, u.workspaceCount,
    u.createdAt, u.lastLoginAt, u.lastActivityAt,
  ].map(csvCell).join(';'));
  return `${BOM}${[header.join(';'), ...rows].join('\r\n')}\r\n`;
}

const PLAN_RU: Record<string, string> = { free: 'Бесплатный', prime: 'Прайм', vip: 'VIP' };

function termText(detail: Readonly<Record<string, unknown>> | null): string {
  if (!detail) return '—';
  const plan = PLAN_RU[String(detail['plan'])] ?? String(detail['plan'] ?? '—');
  const expires = detail['expiresAt'];
  if (detail['plan'] === 'free') return plan;
  return typeof expires === 'string' ? `${plan} до ${dateRu(expires)}` : `${plan} бессрочно`;
}

const FIELD_RU: Record<string, string> = { displayName: 'имя', email: 'почта', avatarUrl: 'фото', telegram: 'Telegram' };

/** One line for the «История действий» list. */
export function auditText(entry: AdminAuditEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.action) {
    case 'profile_update': {
      const parts = Object.keys(after).map((key) => {
        const label = FIELD_RU[key] ?? key;
        if (key === 'avatarUrl') return 'удалено фото';
        if (key === 'telegram') return `отвязан Telegram${before[key] ? ` ${String(before[key])}` : ''}`;
        return `${label}: ${String(before[key] ?? '—')} → ${String(after[key] ?? '—')}`;
      });
      return `Профиль: ${parts.join(', ') || 'изменён'}`;
    }
    case 'role_change': return after['isAdmin'] ? 'Назначен администратором' : 'Сняты права администратора';
    case 'plan_change': return `Тариф: ${termText(entry.before)} → ${termText(entry.after)}`;
    case 'bulk_plan': {
      const size = Number(after['batchSize'] ?? 0);
      return `Тариф (массово${size > 1 ? `, ${size} ${pluralRu(size, 'пользователь', 'пользователя', 'пользователей')}` : ''}): ${termText(entry.before)} → ${termText(entry.after)}`;
    }
    case 'delete': return 'Учётная запись удалена';
    case 'impersonate': return 'Вход от имени пользователя';
    case 'sign_out_all': return 'Завершены все сессии';
    case 'password_reset_sent': return `Отправлена ссылка для смены пароля${after['email'] ? ` на ${String(after['email'])}` : ''}`;
  }
}
