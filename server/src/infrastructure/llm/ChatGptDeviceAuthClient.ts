import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';
import type {
  LlmDeviceAuthClient,
  LlmDeviceCodeGrant,
  LlmDevicePollResult,
  LlmTokenGrant,
} from '../../application/llm/LlmDeviceAuthClient.js';
import {
  LlmDeviceAuthUnavailableError,
  LlmRateLimitedError,
  LlmRefreshRejectedError,
  LlmUpstreamError,
} from '../../domain/llm/errors.js';
import { chatgptAccountInfo } from './chatgptClaims.js';

// Вход в ChatGPT по коду — тот же поток, что у `codex login --device-auth`: сервер просит
// у auth.openai.com одноразовый код, человек вводит его на auth.openai.com/codex/device,
// сервер опрашивает подтверждение и меняет его на OAuth-токены. API-ключ не нужен.
// Перенесено из findClients (src/lib/chatgpt-auth/oauth.ts).

const DEFAULT_ISSUER = 'https://auth.openai.com';
// Публичный client id официального Codex CLI — не секрет.
export const CHATGPT_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REQUEST_TIMEOUT_MS = 30_000;
const MIN_INTERVAL_SEC = 3;
const DEFAULT_INTERVAL_SEC = 5;
// Провайдер не сообщает срок кода; по документации Codex он живёт 15 минут.
const DEVICE_CODE_TTL_SEC = 15 * 60;

export type ChatGptDeviceAuthClientOptions = {
  readonly issuer?: string;
  readonly proxyUrl?: string;
};

export class ChatGptDeviceAuthClient implements LlmDeviceAuthClient {
  private readonly issuer: string;
  private readonly dispatcher: Dispatcher | undefined;

  constructor(options: ChatGptDeviceAuthClientOptions = {}) {
    this.issuer = (options.issuer?.trim() || DEFAULT_ISSUER).replace(/\/+$/, '');
    this.dispatcher = options.proxyUrl?.trim() ? new ProxyAgent(options.proxyUrl.trim()) : undefined;
  }

  async requestDeviceCode(): Promise<LlmDeviceCodeGrant> {
    const response = await this.post('/api/accounts/deviceauth/usercode', {
      json: { client_id: CHATGPT_CODEX_CLIENT_ID },
    });
    if (response.status === 404) throw new LlmDeviceAuthUnavailableError();
    if (response.status === 429) {
      throw new LlmRateLimitedError(null, 'OpenAI временно ограничивает попытки входа — повторите через минуту.');
    }
    if (!response.ok) throw new LlmUpstreamError(response.status, await snippet(response));
    const data = (await response.json()) as {
      user_code?: unknown;
      device_auth_id?: unknown;
      interval?: unknown;
    };
    if (typeof data.user_code !== 'string' || typeof data.device_auth_id !== 'string') {
      throw new LlmUpstreamError(response.status, 'ответ на запрос кода пришёл неполным');
    }
    const interval = Number(data.interval ?? DEFAULT_INTERVAL_SEC);
    return {
      userCode: data.user_code,
      deviceAuthId: data.device_auth_id,
      verificationUrl: `${this.issuer}/codex/device`,
      intervalSec: Math.max(MIN_INTERVAL_SEC, Number.isFinite(interval) ? Math.round(interval) : DEFAULT_INTERVAL_SEC),
      expiresInSec: DEVICE_CODE_TTL_SEC,
    };
  }

  async pollDeviceCode(input: { deviceAuthId: string; userCode: string }): Promise<LlmDevicePollResult> {
    const response = await this.post('/api/accounts/deviceauth/token', {
      json: { device_auth_id: input.deviceAuthId, user_code: input.userCode },
    });
    // 403/404 — «ещё не подтвердили», это не ошибка.
    if (response.status === 403 || response.status === 404) return { status: 'pending' };
    if (!response.ok) throw new LlmUpstreamError(response.status, await snippet(response));
    const data = (await response.json()) as { authorization_code?: unknown; code_verifier?: unknown };
    if (typeof data.authorization_code !== 'string' || typeof data.code_verifier !== 'string') {
      throw new LlmUpstreamError(response.status, 'подтверждение входа пришло без кода авторизации');
    }
    const grant = await this.tokenRequest({
      grant_type: 'authorization_code',
      code: data.authorization_code,
      redirect_uri: `${this.issuer}/deviceauth/callback`,
      client_id: CHATGPT_CODEX_CLIENT_ID,
      code_verifier: data.code_verifier,
    });
    return { status: 'approved', grant };
  }

  async refresh(refreshToken: string): Promise<LlmTokenGrant> {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CHATGPT_CODEX_CLIENT_ID,
    });
  }

  private async tokenRequest(form: Record<string, string>): Promise<LlmTokenGrant> {
    const response = await this.post('/oauth/token', { form });
    if (response.status === 429) {
      throw new LlmRateLimitedError(null, 'OpenAI ограничивает запросы токенов — учётные данные в порядке, повторите позже.');
    }
    if (response.status === 400 || response.status === 401) {
      // Отказ по refresh-токену (истёк, отозван, уже использован) или по коду входа.
      const code = await errorCode(response);
      throw new LlmRefreshRejectedError(code);
    }
    if (!response.ok) throw new LlmUpstreamError(response.status, await snippet(response));
    const data = (await response.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      id_token?: unknown;
    };
    if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
      throw new LlmUpstreamError(response.status, 'ответ пришёл без access_token');
    }
    const refreshToken = typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null;
    const idToken = typeof data.id_token === 'string' && data.id_token ? data.id_token : null;
    return {
      credentials: { accessToken: data.access_token, refreshToken, idToken },
      account: chatgptAccountInfo(data.access_token, idToken),
    };
  }

  private post(
    path: string,
    body: { json: Record<string, unknown> } | { form: Record<string, string> },
  ): Promise<Awaited<ReturnType<typeof undiciFetch>>> {
    const isJson = 'json' in body;
    return undiciFetch(`${this.issuer}${path}`, {
      method: 'POST',
      headers: {
        'content-type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: isJson ? JSON.stringify(body.json) : new URLSearchParams(body.form).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });
  }
}

async function snippet(response: { text(): Promise<string> }): Promise<string> {
  const text = await response.text().catch(() => '');
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function errorCode(response: { text(): Promise<string> }): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const data = JSON.parse(text) as { error?: unknown; code?: unknown };
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error === 'object') {
      const nested = data.error as { code?: unknown; type?: unknown };
      if (typeof nested.code === 'string') return nested.code;
      if (typeof nested.type === 'string') return nested.type;
    }
    if (typeof data.code === 'string') return data.code;
  } catch {
    // не JSON
  }
  return 'invalid_grant';
}
