// Домен исходящих вебхуков проекта (db/138). Чистый слой: без HTTP/DB/DOM/crypto-инфры.
// Здесь — тип подписки, замкнутый список событий и валидаторы URL/событий. Подпись, хеш
// секрета и SSRF-проверка живут в application/infrastructure (там node:crypto/dns).

// Замкнутый набор событий проекта, на которые можно подписать вебхук. Замкнутость — это и
// защита (раздел 4 плана: никаких пользовательских выражений над данными), и стабильный
// контракт для получателя. Имена в стиле '<сущность>.<действие>'.
export const WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.deleted',
  'task.commented',
  'project.updated',
  'member.added',
  'member.removed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// Подписка на все события. Хранится и передаётся как обычный элемент events.
export const WEBHOOK_EVENT_WILDCARD = '*';
export type WebhookEventSubscription = WebhookEvent | typeof WEBHOOK_EVENT_WILDCARD;

// Максимум подписок на проект — граница злоупотребления (фан-аут доставки + место).
export const MAX_WEBHOOKS_PER_PROJECT = 20;

// Событие для тестовой доставки («Проверить» в UI). Не входит в WEBHOOK_EVENTS —
// доставляется адресно одному вебхуку, минуя фильтр подписки.
export const WEBHOOK_TEST_EVENT = 'webhook.ping';

export type ProjectWebhook = {
  readonly id: string;
  readonly projectId: string;
  readonly url: string;
  readonly events: readonly WebhookEventSubscription[];
  readonly enabled: boolean;
  // Итог последней доставки для журнала ('ok:200' | 'error:timeout'…). null — не доставляли.
  readonly lastStatus: string | null;
  readonly lastAt: string | null;
  readonly createdAt: string;
};

// Вебхук + одноразовый секрет. Возвращается ТОЛЬКО из create — секрет больше нигде не всплывает.
export type ProjectWebhookWithSecret = {
  readonly webhook: ProjectWebhook;
  readonly secret: string;
};

export class WebhookUrlInvalidError extends Error {
  constructor(message = 'invalid_webhook_url') {
    super(message);
    this.name = 'WebhookUrlInvalidError';
  }
}

export class WebhookEventsInvalidError extends Error {
  constructor(message = 'invalid_webhook_events') {
    super(message);
    this.name = 'WebhookEventsInvalidError';
  }
}

export class WebhookNotFoundError extends Error {
  constructor() {
    super('webhook_not_found');
    this.name = 'WebhookNotFoundError';
  }
}

export class WebhookLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`webhook_limit_reached:${limit}`);
    this.name = 'WebhookLimitError';
  }
}

// Нормализация URL вебхука. Синхронная, без сети: проверяем схему/креды/длину/парсинг.
// SSRF по IP делается позже, при доставке (assertPublicWebhookTarget) — здесь host не резолвим.
// Требуем HTTPS: секрет подписи и полезная нагрузка не должны ходить по http.
export function normalizeWebhookUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw new WebhookUrlInvalidError();
  const candidate = raw.trim();
  if (!candidate || candidate.length > 2048) throw new WebhookUrlInvalidError();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new WebhookUrlInvalidError();
  }
  if (parsed.protocol !== 'https:') throw new WebhookUrlInvalidError('webhook_url_must_be_https');
  // Креды в URL — вектор утечки и обхода; запрещаем.
  if (parsed.username || parsed.password) throw new WebhookUrlInvalidError();
  return parsed.toString();
}

// Нормализация списка событий: только из белого списка (+ wildcard), дедуп, непусто.
// Wildcard схлопывает список к ['*'] — подписка на всё.
export function normalizeWebhookEvents(raw: unknown): readonly WebhookEventSubscription[] {
  if (!Array.isArray(raw)) throw new WebhookEventsInvalidError();
  const allowed = new Set<string>(WEBHOOK_EVENTS);
  const out = new Set<WebhookEventSubscription>();
  for (const item of raw) {
    if (typeof item !== 'string') throw new WebhookEventsInvalidError();
    if (item === WEBHOOK_EVENT_WILDCARD) return [WEBHOOK_EVENT_WILDCARD];
    if (!allowed.has(item)) throw new WebhookEventsInvalidError(`unknown_event:${item}`);
    out.add(item as WebhookEvent);
  }
  if (out.size === 0) throw new WebhookEventsInvalidError('empty_events');
  return [...out];
}

// Подписан ли вебхук на событие (учитывая wildcard). Тестовое событие адресуется в обход.
export function matchesWebhookEvent(
  webhook: Pick<ProjectWebhook, 'events'>,
  event: string,
): boolean {
  return webhook.events.includes(WEBHOOK_EVENT_WILDCARD) || webhook.events.includes(event as WebhookEvent);
}
