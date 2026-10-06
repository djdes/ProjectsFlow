import type { LlmConnection, LlmCredentials } from '../../domain/llm/LlmConnection.js';
import {
  LlmNotConnectedError,
  LlmReauthRequiredError,
  LlmRefreshRejectedError,
} from '../../domain/llm/errors.js';
import type { LlmConnectionRepository } from './LlmConnectionRepository.js';
import type { LlmDeviceAuthClient } from './LlmDeviceAuthClient.js';
import type { LlmAccess } from './LlmTransport.js';

// Обновляем токен заранее, если до истечения осталось меньше этого (как делает и codex).
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type Deps = {
  readonly connections: LlmConnectionRepository;
  readonly authClient: LlmDeviceAuthClient;
  readonly now?: () => Date;
};

export type LlmAccessGrant = {
  readonly connectionId: string;
  readonly access: LlmAccess;
};

export type AcquireLlmAccessOptions = {
  // Токен, на который провайдер ответил 401. Если в БД уже другой — его и отдаём, иначе
  // обновляем принудительно, не дожидаясь срока истечения.
  readonly rejectedAccessToken?: string;
};

// Выдаёт действующий access-токен подключения. Refresh-токен у провайдера одноразовый:
// два одновременных обновления выбили бы сессию целиком. Поэтому:
//  - внутри процесса обновление одно на подключение (общий промис на все виды запросов);
//  - в БД — оптимистичная блокировка по version: проигравший перечитывает свежие токены.
export class LlmAccessService {
  private readonly refreshing = new Map<string, Promise<LlmAccessGrant>>();

  constructor(private readonly deps: Deps) {}

  async acquire(connectionId: string, opts: AcquireLlmAccessOptions = {}): Promise<LlmAccessGrant> {
    const { connection, credentials } = await this.load(connectionId);
    if (!this.needsRefresh(connection, credentials, opts.rejectedAccessToken)) {
      return grant(connection, credentials.accessToken);
    }
    return this.refreshOnce(connectionId, opts.rejectedAccessToken);
  }

  private refreshOnce(connectionId: string, rejectedAccessToken: string | undefined): Promise<LlmAccessGrant> {
    const existing = this.refreshing.get(connectionId);
    if (existing) return existing;
    const promise = this.refresh(connectionId, rejectedAccessToken).finally(() => {
      this.refreshing.delete(connectionId);
    });
    this.refreshing.set(connectionId, promise);
    return promise;
  }

  private async refresh(connectionId: string, rejectedAccessToken: string | undefined): Promise<LlmAccessGrant> {
    // Перечитываем под «замком»: пока ждали, токен мог уже обновиться.
    const { connection, credentials } = await this.load(connectionId);
    if (!this.needsRefresh(connection, credentials, rejectedAccessToken)) {
      return grant(connection, credentials.accessToken);
    }
    if (!credentials.refreshToken) {
      await this.deps.connections.markStatus(connection.id, 'reauth_required', 'no_refresh_token');
      throw new LlmReauthRequiredError(connection.id, 'no_refresh_token');
    }

    let refreshed;
    try {
      refreshed = await this.deps.authClient.refresh(credentials.refreshToken);
    } catch (e) {
      if (e instanceof LlmRefreshRejectedError) {
        await this.deps.connections.markStatus(connection.id, 'reauth_required', e.code);
        throw new LlmReauthRequiredError(connection.id, e.code);
      }
      throw e;
    }

    const accountId = refreshed.account.accountId ?? connection.accountId;
    const updated = await this.deps.connections.updateTokens({
      id: connection.id,
      expectedVersion: connection.version,
      credentials: {
        accessToken: refreshed.credentials.accessToken,
        // Провайдер не всегда присылает новый refresh/id-токен — тогда остаются прежние.
        refreshToken: refreshed.credentials.refreshToken ?? credentials.refreshToken,
        idToken: refreshed.credentials.idToken ?? credentials.idToken,
      },
      account: {
        accountId,
        email: refreshed.account.email ?? connection.accountEmail,
        planType: refreshed.account.planType ?? connection.planType,
        accessExpiresAt: refreshed.account.accessExpiresAt,
      },
      refreshedAt: this.now(),
    });
    if (updated) {
      return {
        connectionId: connection.id,
        access: { accessToken: refreshed.credentials.accessToken, accountId },
      };
    }

    // Строку успели обновить в обход этого процесса — берём то, что записано.
    const latest = await this.load(connection.id);
    return grant(latest.connection, latest.credentials.accessToken);
  }

  private async load(
    connectionId: string,
  ): Promise<{ connection: LlmConnection; credentials: LlmCredentials }> {
    const connection = await this.deps.connections.findById(connectionId);
    if (!connection) throw new LlmNotConnectedError();
    if (connection.status === 'reauth_required') {
      throw new LlmReauthRequiredError(connection.id, connection.lastError ?? 'reauth_required');
    }
    if (connection.status === 'disabled') throw new LlmNotConnectedError();
    const credentials = await this.deps.connections.getCredentials(connection.id);
    if (!credentials) {
      // Токены нельзя расшифровать (сменился LLM_TOKEN_KEY) — восстанавливается входом по коду.
      await this.deps.connections.markStatus(connection.id, 'reauth_required', 'token_undecryptable');
      throw new LlmReauthRequiredError(connection.id, 'token_undecryptable');
    }
    return { connection, credentials };
  }

  private needsRefresh(
    connection: LlmConnection,
    credentials: LlmCredentials,
    rejectedAccessToken: string | undefined,
  ): boolean {
    if (rejectedAccessToken !== undefined) {
      // Провайдер отверг именно этот токен. Если в БД уже другой — обновлять не нужно.
      return credentials.accessToken === rejectedAccessToken;
    }
    if (connection.accessExpiresAt === null) return false;
    return connection.accessExpiresAt.getTime() - this.now().getTime() <= REFRESH_MARGIN_MS;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

function grant(connection: LlmConnection, accessToken: string): LlmAccessGrant {
  return {
    connectionId: connection.id,
    access: { accessToken, accountId: connection.accountId },
  };
}
