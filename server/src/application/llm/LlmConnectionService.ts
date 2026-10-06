import type {
  LlmConnection,
  LlmConnectionOwner,
  LlmProvider,
} from '../../domain/llm/LlmConnection.js';
import type { LlmDeviceLogin } from '../../domain/llm/LlmDeviceLogin.js';
import type { LlmSettings } from '../../domain/llm/LlmSettings.js';
import { LlmDeviceLoginNotFoundError, LlmNotConnectedError } from '../../domain/llm/errors.js';
import type { LlmAccessService } from './LlmAccessService.js';
import type { LlmConnectionRepository } from './LlmConnectionRepository.js';
import type { LlmDeviceAuthClient } from './LlmDeviceAuthClient.js';
import type { LlmDeviceLoginRepository } from './LlmDeviceLoginRepository.js';
import type { LlmSettingsService } from './LlmSettingsService.js';
import type { LlmTransport } from './LlmTransport.js';

// Код у провайдера живёт 15 минут; если провайдер не сказал срок — берём столько же.
const DEFAULT_LOGIN_TTL_SEC = 15 * 60;
const TEST_TIMEOUT_MS = 60_000;

type Deps = {
  readonly provider: LlmProvider;
  readonly connections: LlmConnectionRepository;
  readonly deviceLogins: LlmDeviceLoginRepository;
  readonly authClient: LlmDeviceAuthClient;
  readonly access: LlmAccessService;
  readonly transport: LlmTransport;
  readonly settings: LlmSettingsService;
  readonly now?: () => Date;
};

export type LlmConnectionStatusView = {
  readonly connection: LlmConnection | null;
  readonly pendingLogin: LlmDeviceLogin | null;
  readonly settings: LlmSettings;
};

export type PollLlmLoginResult =
  | { readonly status: 'idle' }
  | { readonly status: 'pending'; readonly login: LlmDeviceLogin }
  | { readonly status: 'expired' }
  | { readonly status: 'connected'; readonly connection: LlmConnection };

export type TestLlmConnectionResult = {
  readonly ok: boolean;
  readonly model: string;
  readonly latencyMs: number;
  readonly reply: string | null;
  readonly error: string | null;
};

// Подключение подписки по коду и управление им. Владелец — параметр: сейчас админка
// работает с платформенным подключением, личные подключения пользователей пойдут через
// те же сценарии с owner = { scope: 'user' }.
export class LlmConnectionService {
  constructor(private readonly deps: Deps) {}

  async getStatus(owner: LlmConnectionOwner): Promise<LlmConnectionStatusView> {
    const [connection, pendingLogin, settings] = await Promise.all([
      this.deps.connections.findByOwner(owner, this.deps.provider),
      this.findLiveLogin(owner),
      this.deps.settings.get(),
    ]);
    return { connection, pendingLogin, settings };
  }

  async startLogin(input: { owner: LlmConnectionOwner; actorUserId: string }): Promise<LlmDeviceLogin> {
    const code = await this.deps.authClient.requestDeviceCode();
    const ttlSec = code.expiresInSec > 0 ? code.expiresInSec : DEFAULT_LOGIN_TTL_SEC;
    return this.deps.deviceLogins.replace({
      owner: input.owner,
      provider: this.deps.provider,
      userCode: code.userCode,
      deviceAuthId: code.deviceAuthId,
      verificationUrl: code.verificationUrl,
      intervalSec: code.intervalSec,
      expiresAt: new Date(this.now().getTime() + ttlSec * 1000),
      createdBy: input.actorUserId,
    });
  }

  // Один шаг проверки подтверждения. Клиент зовёт с интервалом, который назвал провайдер,
  // поэтому ни один HTTP-запрос не висит минутами.
  async pollLogin(owner: LlmConnectionOwner): Promise<PollLlmLoginResult> {
    const login = await this.deps.deviceLogins.find(owner, this.deps.provider);
    if (!login) return { status: 'idle' };
    if (login.expiresAt <= this.now()) {
      await this.deps.deviceLogins.delete(owner, this.deps.provider);
      return { status: 'expired' };
    }
    const result = await this.deps.authClient.pollDeviceCode({
      deviceAuthId: login.deviceAuthId,
      userCode: login.userCode,
    });
    if (result.status === 'pending') return { status: 'pending', login };

    const connection = await this.deps.connections.upsert({
      owner,
      provider: this.deps.provider,
      credentials: result.grant.credentials,
      account: result.grant.account,
      createdBy: login.createdBy,
    });
    await this.deps.deviceLogins.delete(owner, this.deps.provider);
    return { status: 'connected', connection };
  }

  async cancelLogin(owner: LlmConnectionOwner): Promise<void> {
    const login = await this.deps.deviceLogins.find(owner, this.deps.provider);
    if (!login) throw new LlmDeviceLoginNotFoundError();
    await this.deps.deviceLogins.delete(owner, this.deps.provider);
  }

  async disconnect(owner: LlmConnectionOwner): Promise<void> {
    const connection = await this.deps.connections.findByOwner(owner, this.deps.provider);
    await this.deps.deviceLogins.delete(owner, this.deps.provider);
    if (connection) await this.deps.connections.delete(connection.id);
  }

  // Короткий настоящий запрос к модели: проверяет токены, сеть сервера до провайдера и
  // лимиты. Ошибку возвращаем текстом, а не исключением, — её показывают в админке.
  async test(owner: LlmConnectionOwner): Promise<TestLlmConnectionResult> {
    const settings = await this.deps.settings.get();
    const model = settings.fastModel;
    const startedAt = Date.now();
    try {
      const connection = await this.deps.connections.findByOwner(owner, this.deps.provider);
      if (!connection) throw new LlmNotConnectedError();
      const grant = await this.deps.access.acquire(connection.id);
      const result = await this.deps.transport.generateText(grant.access, {
        model,
        instructions: 'Ты проверяешь связь. Ответь ровно одним словом: готово',
        input: 'Проверка связи',
        reasoningEffort: 'low',
        timeoutMs: TEST_TIMEOUT_MS,
      });
      void this.deps.connections.touchUsed(connection.id, this.now()).catch(() => {});
      return { ok: true, model, latencyMs: Date.now() - startedAt, reply: result.text.slice(0, 200), error: null };
    } catch (e) {
      return {
        ok: false,
        model,
        latencyMs: Date.now() - startedAt,
        reply: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async findLiveLogin(owner: LlmConnectionOwner): Promise<LlmDeviceLogin | null> {
    const login = await this.deps.deviceLogins.find(owner, this.deps.provider);
    if (!login || login.expiresAt <= this.now()) return null;
    return login;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
