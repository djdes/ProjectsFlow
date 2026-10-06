import type { LlmAccessService } from './LlmAccessService.js';
import type { LlmConnectionRepository } from './LlmConnectionRepository.js';
import type { LlmRouter } from './LlmRouter.js';
import type { LlmRawResponse, LlmTransport } from './LlmTransport.js';

// Если провайдер не сказал время сброса, это скорее короткий всплеск, а не исчерпанная
// подписка, — делаем короткую паузу.
const DEFAULT_COOLDOWN_MS = 60 * 1000;

export type LlmGatewayRequest = {
  // На кого записывается работа воркера — от этого зависит выбор подключения.
  readonly billedUserId: string | null;
  readonly subpath: string;
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
};

type Deps = {
  readonly router: LlmRouter;
  readonly access: LlmAccessService;
  readonly transport: LlmTransport;
  readonly connections: LlmConnectionRepository;
  readonly now?: () => Date;
};

// Шлюз для codex на машине диспетчера: codex ходит сюда со своим токеном воркера, сервер
// подставляет токены подписки и проксирует поток ответа как есть. Токены провайдера не
// покидают сервер, обновляет их только он.
export class LlmGateway {
  constructor(private readonly deps: Deps) {}

  async forward(request: LlmGatewayRequest): Promise<LlmRawResponse> {
    const connection = await this.deps.router.resolve({ billedUserId: request.billedUserId });
    let grant = await this.deps.access.acquire(connection.id);
    let response = await this.deps.transport.forward(grant.access, request);

    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      grant = await this.deps.access.acquire(connection.id, {
        rejectedAccessToken: grant.access.accessToken,
      });
      response = await this.deps.transport.forward(grant.access, request);
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
