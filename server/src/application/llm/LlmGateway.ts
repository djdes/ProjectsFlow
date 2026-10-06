import type { LlmAccessService } from './LlmAccessService.js';
import type { LlmConnectionRepository } from './LlmConnectionRepository.js';
import type { LlmRouter } from './LlmRouter.js';
import type { LlmRawResponse, LlmTransport } from './LlmTransport.js';
import { blockToolCallOutsideWorkspace, type ToolCallViolation } from './workspaceToolCallPolicy.js';

// Если провайдер не сказал время сброса, это скорее короткий всплеск, а не исчерпанная
// подписка, — делаем короткую паузу.
const DEFAULT_COOLDOWN_MS = 60 * 1000;

export type LlmGatewayRequest = {
  // На кого записывается работа воркера — от этого зависит выбор подключения.
  readonly billedUserId: string | null;
  readonly subpath: string;
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string>>;
  // Модель, которую на самом деле вызвать. codex запускается с моделью «классического»
  // формата (обычные инструменты-функции, их аргументы видны шлюзу), а работает другая.
  readonly upstreamModel?: string | null;
  // Рабочая папка воркера на машине диспетчера: вызовы команд вне неё блокируются.
  readonly workspaceRoot: string | null;
  readonly signal?: AbortSignal;
};

export type BlockedToolCall = {
  readonly billedUserId: string | null;
  readonly workspaceRoot: string | null;
  readonly violation: ToolCallViolation;
};

type Deps = {
  readonly router: LlmRouter;
  readonly access: LlmAccessService;
  readonly transport: LlmTransport;
  readonly connections: LlmConnectionRepository;
  readonly onToolCallBlocked?: (event: BlockedToolCall) => void;
  readonly now?: () => Date;
};

// Шлюз для codex на машине диспетчера: codex ходит сюда со своим токеном воркера, сервер
// подставляет токены подписки и проксирует поток ответа. Токены провайдера не покидают
// сервер, обновляет их только он. Вызовы команд модели проверяются до того, как их получит
// codex (см. workspaceToolCallPolicy).
export class LlmGateway {
  constructor(private readonly deps: Deps) {}

  async forward(request: LlmGatewayRequest): Promise<LlmRawResponse> {
    const connection = await this.deps.router.resolve({ billedUserId: request.billedUserId });
    const upstream = {
      subpath: request.subpath,
      body: request.upstreamModel ? withModel(request.body, request.upstreamModel) : request.body,
      headers: request.headers,
      signal: request.signal,
      transformOutputItem: (item: unknown) => {
        const blocked = blockToolCallOutsideWorkspace(item, request.workspaceRoot);
        if (!blocked) return null;
        this.deps.onToolCallBlocked?.({
          billedUserId: request.billedUserId,
          workspaceRoot: request.workspaceRoot,
          violation: blocked.violation,
        });
        return blocked.item;
      },
    };
    let grant = await this.deps.access.acquire(connection.id);
    let response = await this.deps.transport.forward(grant.access, upstream);

    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      grant = await this.deps.access.acquire(connection.id, {
        rejectedAccessToken: grant.access.accessToken,
      });
      response = await this.deps.transport.forward(grant.access, upstream);
      if (response.status === 401) {
        await this.deps.connections.markStatus(connection.id, 'reauth_required', 'unauthorized');
      }
    }

    if (response.status === 429) {
      const until =
        response.rateLimitResetsAt ?? new Date(this.now().getTime() + DEFAULT_COOLDOWN_MS);
      await this.deps.connections
        .markRateLimited(connection.id, until, response.errorDetail ?? 'usage_limit')
        .catch(() => {});
    } else if (response.status >= 200 && response.status < 300) {
      void this.deps.connections.touchUsed(connection.id, this.now()).catch(() => {});
    }
    return response;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

// Тело запроса Responses API — JSON. Не разобралось (сжатие, не JSON) — уходит как есть.
function withModel(body: Buffer, model: string): Buffer {
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
    return Buffer.from(JSON.stringify({ ...parsed, model }), 'utf8');
  } catch {
    return body;
  }
}
