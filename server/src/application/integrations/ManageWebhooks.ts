import { createHash, randomBytes } from 'node:crypto';
import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import {
  MAX_WEBHOOKS_PER_PROJECT,
  WebhookLimitError,
  WebhookNotFoundError,
  normalizeWebhookEvents,
  normalizeWebhookUrl,
  type ProjectWebhook,
  type ProjectWebhookWithSecret,
  type WebhookEventSubscription,
} from '../../domain/integrations/ProjectWebhook.js';
import type { DispatchWebhook, WebhookDeliveryResult } from './DispatchWebhook.js';

// Хранимая форма вебхука: доменный тип + hex-хеш секрета (HMAC-ключ доставки). Наружу, в
// presentation, отдаём БЕЗ secretHash (public ProjectWebhook) — хеш нужен только доставке.
export type ProjectWebhookRecord = ProjectWebhook & { readonly secretHash: string };

export type CreateWebhookInput = {
  readonly url: unknown;
  readonly events: unknown;
};

export type UpdateWebhookInput = {
  readonly url?: unknown;
  readonly events?: unknown;
  readonly enabled?: unknown;
};

// Порт хранилища подписок (db/138). Реализация — DrizzleProjectWebhookRepository.
export interface ProjectWebhookRepository {
  listByProject(projectId: string): Promise<readonly ProjectWebhookRecord[]>;
  getById(projectId: string, id: string): Promise<ProjectWebhookRecord | null>;
  countByProject(projectId: string): Promise<number>;
  insert(record: ProjectWebhookRecord): Promise<void>;
  update(
    projectId: string,
    id: string,
    patch: {
      readonly url?: string;
      readonly events?: readonly WebhookEventSubscription[];
      readonly enabled?: boolean;
    },
  ): Promise<ProjectWebhookRecord | null>;
  delete(projectId: string, id: string): Promise<boolean>;
  // Итог доставки для журнала. Best-effort — доставка не должна падать из-за записи статуса.
  recordDelivery(id: string, status: string, at: string): Promise<void>;
}

type Deps = ProjectAccessDeps & {
  readonly webhooks: ProjectWebhookRepository;
  readonly dispatcher: DispatchWebhook;
  readonly idGen: () => string;
  readonly now?: () => Date;
};

// Публичная форма без secretHash — то, что уходит в API/UI.
function toPublic(record: ProjectWebhookRecord): ProjectWebhook {
  const { secretHash: _secretHash, ...rest } = record;
  return rest;
}

// Генерация одноразового секрета подписи + его SHA-256 (то, что кладём в базу).
// Секрет показывается пользователю ОДИН раз (create), в базе — только hash (раздел 4 плана).
function generateSecret(): { secret: string; secretHash: string } {
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const secretHash = createHash('sha256').update(secret).digest('hex');
  return { secret, secretHash };
}

// Управление подписками на исходящие вебхуки. Все операции требуют update_project:
// конфигурация интеграций — админ-уровень, а URL вебхука сам по себе чувствителен.
export class ManageWebhooks {
  constructor(private readonly deps: Deps) {}

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async list(projectId: string, userId: string): Promise<readonly ProjectWebhook[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const records = await this.deps.webhooks.listByProject(projectId);
    return records.map(toPublic);
  }

  async create(
    projectId: string,
    userId: string,
    input: CreateWebhookInput,
  ): Promise<ProjectWebhookWithSecret> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const url = normalizeWebhookUrl(input.url);
    const events = normalizeWebhookEvents(input.events);
    const count = await this.deps.webhooks.countByProject(projectId);
    if (count >= MAX_WEBHOOKS_PER_PROJECT) throw new WebhookLimitError(MAX_WEBHOOKS_PER_PROJECT);
    const { secret, secretHash } = generateSecret();
    const record: ProjectWebhookRecord = {
      id: this.deps.idGen(),
      projectId,
      url,
      events,
      enabled: true,
      lastStatus: null,
      lastAt: null,
      createdAt: this.clock().toISOString(),
      secretHash,
    };
    await this.deps.webhooks.insert(record);
    // Секрет возвращаем ЗДЕСЬ и только здесь — повторно его получить нельзя.
    return { webhook: toPublic(record), secret };
  }

  async update(
    projectId: string,
    userId: string,
    id: string,
    input: UpdateWebhookInput,
  ): Promise<ProjectWebhook> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const patch: {
      url?: string;
      events?: readonly WebhookEventSubscription[];
      enabled?: boolean;
    } = {};
    if (input.url !== undefined) patch.url = normalizeWebhookUrl(input.url);
    if (input.events !== undefined) patch.events = normalizeWebhookEvents(input.events);
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
    const updated = await this.deps.webhooks.update(projectId, id, patch);
    if (!updated) throw new WebhookNotFoundError();
    return toPublic(updated);
  }

  async remove(projectId: string, userId: string, id: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const deleted = await this.deps.webhooks.delete(projectId, id);
    if (!deleted) throw new WebhookNotFoundError();
  }

  // «Проверить»: адресная тестовая доставка одному вебхуку (событие webhook.ping),
  // минуя фильтр подписки. Обновляет last_status/last_at через доставку.
  async test(projectId: string, userId: string, id: string): Promise<WebhookDeliveryResult> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const record = await this.deps.webhooks.getById(projectId, id);
    if (!record) throw new WebhookNotFoundError();
    return this.deps.dispatcher.deliverTest(record);
  }
}
