import { createHmac, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { ActivityRecorder, type RecordInput } from '../activity/ActivityRecorder.js';
import type { ActivityKind } from '../../domain/activity/ActivityEvent.js';
import {
  WEBHOOK_TEST_EVENT,
  matchesWebhookEvent,
  type WebhookEvent,
} from '../../domain/integrations/ProjectWebhook.js';
import type { ProjectWebhookRecord, ProjectWebhookRepository } from './ManageWebhooks.js';

export type WebhookDeliveryResult = {
  readonly ok: boolean;
  // Короткий машинный итог для журнала: 'ok:200' | 'error:timeout' | 'error:blocked' …
  readonly status: string;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type Deps = {
  readonly webhooks: ProjectWebhookRepository;
  readonly idGen?: () => string;
  readonly now?: () => Date;
  // Инъекция для тестов; по умолчанию — глобальный fetch.
  readonly fetchImpl?: FetchLike;
};

// Таймаут доставки. Короткий: медленный/зависший получатель не должен держать наш поток.
const DELIVERY_TIMEOUT_MS = 5_000;
// Потолок тела запроса, отдаваемого получателю (payload детерминирован, но страхуемся).
const MAX_BODY_BYTES = 64 * 1024;

// SSRF-защита: URL вебхука задаёт пользователь. Резолвим хост и проверяем КАЖДЫЙ IP —
// приватные/loopback/link-local/multicast диапазоны запрещены. Иначе вебхук превращается в
// сканер внутренней сети VPS (раздел 4 плана, риск SSRF). Проверяется при КАЖДОЙ доставке,
// а не только при создании: DNS может перепривязаться (rebinding) между сохранением и отправкой.
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const parts = address.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    return (
      a === 0 || // 0.0.0.0/8 «this network»
      a === 10 || // 10/8 private
      a === 127 || // 127/8 loopback
      a >= 224 || // 224/4 multicast + 240/4 reserved
      (a === 169 && b === 254) || // 169.254/16 link-local
      (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
      (a === 192 && b === 168) || // 192.168/16 private
      (a === 100 && b >= 64 && b <= 127) // 100.64/10 CGNAT
    );
  }
  const v = address.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — проверяем встроенный IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  return (
    v === '::1' || // loopback
    v === '::' || // unspecified
    v.startsWith('fc') || // fc00::/7 unique-local
    v.startsWith('fd') ||
    v.startsWith('fe8') || // fe80::/10 link-local
    v.startsWith('fe9') ||
    v.startsWith('fea') ||
    v.startsWith('feb') ||
    v.startsWith('ff') // ff00::/8 multicast
  );
}

// Проверка цели вебхука перед отправкой: https, без кредов, все резолвленные IP — публичные.
// Бросает Error('blocked_*') при нарушении — доставка ловит и пишет 'error:blocked' в журнал.
// Возвращает валидированные адреса, чтобы доставка КОННЕКТИЛАСЬ именно к ним, а не резолвила
// хост заново: без этого между проверкой и fetch остаётся окно DNS-rebinding (TOCTOU) —
// атакующий DNS с TTL 0 отдаёт публичный IP на проверку и приватный на коннект.
export async function assertPublicWebhookTarget(url: string): Promise<readonly string[]> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('blocked_invalid_url');
  }
  if (parsed.protocol !== 'https:') throw new Error('blocked_scheme');
  if (parsed.username || parsed.password) throw new Error('blocked_credentials');
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error('blocked_no_dns');
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('blocked_private_ip');
  return addresses.map(({ address }) => address);
}

// undici-агент, который резолвит хост ТОЛЬКО в заранее проверенные адреса и повторно
// проверяет каждый прямо в момент коннекта. Это финальный барьер против DNS-rebinding:
// даже если DNS сменился между валидацией и доставкой, коннект пойдёт на проверенный IP,
// а неожиданный приватный адрес будет отвергнут здесь же. null — когда undici недоступен
// (тестовое окружение с моком fetch), тогда сеть всё равно не идёт.
function pinnedDispatcher(validatedIps: readonly string[]): unknown {
  if (validatedIps.length === 0) return null;
  let Agent: (new (opts: unknown) => unknown) | undefined;
  try {
    // Ленивая загрузка: undici — транзитивная зависимость Node fetch, но не в наших deps.
    // createRequire, а не голый require — модуль ESM, require в нём не определён.
    const req = createRequire(import.meta.url);
    Agent = (req('undici') as { Agent?: new (opts: unknown) => unknown }).Agent;
  } catch {
    return null;
  }
  if (!Agent) return null;
  const pinned = new Set(validatedIps);
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        _opts: unknown,
        cb: (err: Error | null, address: string, family: number) => void,
      ): void => {
        const ip = validatedIps[0]!;
        if (!pinned.has(ip) || isPrivateAddress(ip)) {
          cb(new Error('blocked_private_ip'), '', 0);
          return;
        }
        cb(null, ip, isIP(ip) === 6 ? 6 : 4);
      },
    },
  });
}

// Подпись доставки. Ключ HMAC = secretHash (hex, лежит в базе). Получатель, которому секрет
// показали ОДИН раз, выводит тот же ключ как sha256(secret) и проверяет подпись. Так открытый
// секрет не хранится у нас, но подпись остаётся проверяемой (раздел 4 плана, срез 6).
export function signWebhookPayload(secretHash: string, timestamp: string, body: string): string {
  return createHmac('sha256', secretHash).update(`${timestamp}.${body}`).digest('hex');
}

// Маппинг вида действия ленты в имя события вебхука. null — событие не транслируется наружу
// (напр. project_created/member_role_changed без подписки). Замкнутый список — см. WEBHOOK_EVENTS.
export function activityKindToWebhookEvent(kind: ActivityKind): WebhookEvent | null {
  switch (kind) {
    case 'task_created':
      return 'task.created';
    case 'task_updated':
      return 'task.updated';
    case 'task_status_changed':
      return 'task.status_changed';
    case 'task_deleted':
      return 'task.deleted';
    case 'task_commented':
      return 'task.commented';
    case 'project_updated':
      return 'project.updated';
    case 'member_added':
      return 'member.added';
    case 'member_removed':
      return 'member.removed';
    default:
      return null;
  }
}

export class DispatchWebhook {
  constructor(private readonly deps: Deps) {}

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private get fetchImpl(): FetchLike {
    return this.deps.fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  // Фан-аут события всем подписанным включённым вебхукам проекта. Best-effort: ошибки
  // отдельных доставок изолированы и записаны в журнал, но не всплывают в вызывающий код.
  async dispatch(projectId: string, event: WebhookEvent, data: unknown): Promise<void> {
    let records: readonly ProjectWebhookRecord[];
    try {
      records = await this.deps.webhooks.listByProject(projectId);
    } catch {
      return;
    }
    const targets = records.filter((w) => w.enabled && matchesWebhookEvent(w, event));
    await Promise.all(targets.map((record) => this.deliverOne(record, event, data)));
  }

  // Адресная тестовая доставка одному вебхуку («Проверить»). Событие webhook.ping.
  async deliverTest(record: ProjectWebhookRecord): Promise<WebhookDeliveryResult> {
    return this.deliverOne(record, WEBHOOK_TEST_EVENT, { message: 'ProjectsFlow webhook test' });
  }

  private async deliverOne(
    record: ProjectWebhookRecord,
    event: string,
    data: unknown,
  ): Promise<WebhookDeliveryResult> {
    const result = await this.attemptDelivery(record, event, data);
    // Журнал доставки — best-effort, не должен ронять доставку.
    try {
      await this.deps.webhooks.recordDelivery(record.id, result.status, this.clock().toISOString());
    } catch {
      /* игнорируем: журнал вторичен */
    }
    return result;
  }

  private async attemptDelivery(
    record: ProjectWebhookRecord,
    event: string,
    data: unknown,
  ): Promise<WebhookDeliveryResult> {
    // SSRF-гейт ДО любого сетевого обращения. Возвращённые адреса используем для pinning
    // при коннекте — иначе fetch резолвит хост заново и открывает окно DNS-rebinding.
    let validatedIps: readonly string[];
    try {
      validatedIps = await assertPublicWebhookTarget(record.url);
    } catch (err) {
      const reason = err instanceof Error ? err.message.replace(/^blocked_/, '') : 'blocked';
      return { ok: false, status: `error:${reason}` };
    }

    const deliveryId = this.deps.idGen ? this.deps.idGen() : randomUUID();
    const timestamp = this.clock().toISOString();
    const body = JSON.stringify({
      id: deliveryId,
      event,
      projectId: record.projectId,
      createdAt: timestamp,
      data: data ?? null,
    });
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      return { ok: false, status: 'error:payload_too_large' };
    }
    const signature = signWebhookPayload(record.secretHash, timestamp, body);

    // Pinning: undici-агент коннектится ТОЛЬКО к уже проверенным IP и валидирует их ещё раз
    // в момент коннекта. Так закрывается TOCTOU-окно: fetch не может резолвить хост в приватный
    // адрес между проверкой и доставкой. Мок в тестах игнорирует dispatcher — там сеть не идёт.
    const dispatcher = pinnedDispatcher(validatedIps);
    try {
      const response = await this.fetchImpl(record.url, {
        method: 'POST',
        // redirect:'error' — редиректы запрещены: 302 на внутренний адрес обходит SSRF-гейт.
        redirect: 'error',
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        ...(dispatcher ? { dispatcher } : {}),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'ProjectsFlow-Webhook/1.0',
          'x-projectsflow-event': event,
          'x-projectsflow-delivery': deliveryId,
          'x-projectsflow-timestamp': timestamp,
          'x-projectsflow-signature': `sha256=${signature}`,
        },
        body,
      } as RequestInit);
      return response.ok
        ? { ok: true, status: `ok:${response.status}` }
        : { ok: false, status: `error:${response.status}` };
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'timeout'
          : err instanceof Error && err.name === 'AbortError'
            ? 'timeout'
            : 'network';
      return { ok: false, status: `error:${reason}` };
    }
  }
}

// Декоратор ленты действий: после записи события фан-аутит его подписанным вебхукам проекта.
// Подкласс ActivityRecorder (а не отдельный класс) — чтобы оставаться присваиваемым везде, где
// composition root ждёт ActivityRecorder, не трогая ~40 мест инъекции и сам ActivityRecorder.
// Так «создание задачи доставляет подписанный POST» достигается через wiring, без правки CreateTask.
export class WebhookDispatchingActivityRecorder extends ActivityRecorder {
  constructor(
    deps: ConstructorParameters<typeof ActivityRecorder>[0],
    private readonly dispatchWebhook: DispatchWebhook,
  ) {
    super(deps);
  }

  override async record(input: RecordInput): Promise<void> {
    await super.record(input);
    const event = activityKindToWebhookEvent(input.kind);
    if (!event) return;
    // Полностью best-effort и вне критического пути: не ждём и не роняем основную операцию.
    void this.dispatchWebhook
      .dispatch(input.projectId, event, input.payload ?? null)
      .catch(() => {});
  }
}
