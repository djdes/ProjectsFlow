import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';
import type {
  LlmAccess,
  LlmRateLimits,
  LlmRateLimitWindow,
  LlmRawRequest,
  LlmRawResponse,
  LlmTextRequest,
  LlmTextResult,
  LlmTransport,
  LlmUsage,
} from '../../application/llm/LlmTransport.js';
import {
  LlmEmptyResponseError,
  LlmRateLimitedError,
  LlmUnauthorizedError,
  LlmUpstreamBlockedError,
  LlmUpstreamError,
} from '../../domain/llm/errors.js';
import { parseSseEvents, type SseEvent } from './sse.js';

// Транспорт к бэкенду Codex в ChatGPT (тот же адрес, куда ходит официальный codex с входом
// через ChatGPT). Это внутренний адрес OpenAI без публичной документации — весь доступ к
// нему собран здесь, чтобы при изменениях править одно место. Перенесено из findClients
// (src/lib/demo-gen/providers/chatgpt.ts) и дополнено проксированием для шлюза Ralph.

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const ORIGINATOR = 'codex_cli_rs';
const USER_AGENT = 'codex_cli_rs/0.160.0 (ProjectsFlow)';

// Заголовки codex, которые несут смысл для бэкенда (формат запроса, сессия, бета-флаги).
// Авторизацию и аккаунт подставляет сервер, остальное от клиента не пропускаем.
const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'content-encoding',
  'accept',
  'openai-beta',
  'session-id',
  'thread-id',
  'x-client-request-id',
  'x-codex-beta-features',
  'x-codex-turn-metadata',
  'x-codex-window-id',
  'x-openai-internal-codex-responses-lite',
] as const;

// Заголовки ответа, которые codex читает (лимиты, id запроса, тип потока).
const FORWARDED_RESPONSE_HEADER_RE = /^(content-type|cache-control|retry-after|x-request-id|openai-[a-z0-9-]+|x-codex-[a-z0-9-]+)$/;

export type ChatGptCodexTransportOptions = {
  readonly baseUrl?: string;
  readonly proxyUrl?: string;
};

export class ChatGptCodexTransport implements LlmTransport {
  private readonly baseUrl: string;
  private readonly dispatcher: Dispatcher | undefined;

  constructor(options: ChatGptCodexTransportOptions = {}) {
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.dispatcher = options.proxyUrl?.trim() ? new ProxyAgent(options.proxyUrl.trim()) : undefined;
  }

  async generateText(access: LlmAccess, request: LlmTextRequest): Promise<LlmTextResult> {
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)])
      : AbortSignal.timeout(request.timeoutMs);
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          ...this.authHeaders(access),
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: request.model,
          instructions: request.instructions,
          input: [
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: request.input }] },
          ],
          reasoning: { effort: request.reasoningEffort },
          // store: false обязателен — с true бэкенд отклоняет запрос.
          store: false,
          stream: true,
        }),
        signal,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new LlmUpstreamError(0, `нет ответа за ${Math.round(request.timeoutMs / 1000)} с`);
      }
      throw new LlmUpstreamError(0, `не удалось связаться: ${e instanceof Error ? e.message : String(e)}`);
    }

    const headers = headerRecord(response.headers);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw toTransportError(response.status, text, headers);
    }
    const raw = await response.text();
    const parsed = extractResponse(parseSseEvents(raw), raw);
    return {
      text: parsed.text,
      model: parsed.model ?? request.model,
      usage: parsed.usage,
      rateLimits: parseRateLimits(headers),
    };
  }

  async forward(access: LlmAccess, request: LlmRawRequest): Promise<LlmRawResponse> {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (value) headers[name] = value;
    }
    Object.assign(headers, this.authHeaders(access));
    headers['originator'] = request.headers['originator'] || ORIGINATOR;
    headers['user-agent'] = request.headers['user-agent'] || USER_AGENT;

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(`${this.baseUrl}/responses${request.subpath}`, {
        method: 'POST',
        headers,
        body: request.body,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (e) {
      throw new LlmUpstreamError(0, `не удалось связаться: ${e instanceof Error ? e.message : String(e)}`);
    }

    const all = headerRecord(response.headers);
    const forwarded: Record<string, string> = {};
    for (const [name, value] of Object.entries(all)) {
      if (FORWARDED_RESPONSE_HEADER_RE.test(name)) forwarded[name] = value;
    }

    if (response.ok) {
      return { status: response.status, headers: forwarded, body: response.body as ReadableStream<Uint8Array> | null };
    }

    // Тело ошибки маленькое: читаем, чтобы понять причину, и отдаём клиенту заново.
    const text = await response.text().catch(() => '');
    const error = toTransportError(response.status, text, all);
    return {
      status: response.status,
      headers: forwarded,
      body: new Blob([text]).stream() as ReadableStream<Uint8Array>,
      rateLimitResetsAt: error instanceof LlmRateLimitedError ? error.resetsAt : null,
      errorDetail: error.message.slice(0, 500),
    };
  }

  private authHeaders(access: LlmAccess): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${access.accessToken}`,
      originator: ORIGINATOR,
      'user-agent': USER_AGENT,
    };
    // Без account id бэкенд отвечает 401.
    if (access.accountId) headers['chatgpt-account-id'] = access.accountId;
    return headers;
  }
}

function headerRecord(headers: { forEach(cb: (value: string, key: string) => void): void }): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function toTransportError(
  status: number,
  body: string,
  headers: Readonly<Record<string, string>>,
): Error {
  const detail = errorMessageFromBody(body);
  if (status === 401) return new LlmUnauthorizedError(`Provider rejected the access token (401): ${detail}`);
  if (status === 403) {
    const blocked = /<html|cloudflare|cf-ray|just a moment/i.test(body)
      ? 'похоже на блокировку по IP или региону — проверьте выход сервера в интернет или прокси'
      : detail;
    return new LlmUpstreamBlockedError(blocked);
  }
  if (status === 429) {
    return new LlmRateLimitedError(
      rateLimitResetFrom(body, headers),
      `Достигнут лимит подписки ChatGPT: ${detail}`,
    );
  }
  return new LlmUpstreamError(status, detail);
}

function errorMessageFromBody(body: string): string {
  try {
    const data = JSON.parse(body) as { error?: unknown; detail?: unknown; message?: unknown };
    if (data.error && typeof data.error === 'object') {
      const message = (data.error as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message.slice(0, 300);
    }
    if (typeof data.error === 'string') return data.error.slice(0, 300);
    if (typeof data.detail === 'string') return data.detail.slice(0, 300);
    if (typeof data.message === 'string') return data.message.slice(0, 300);
  } catch {
    // не JSON
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 300) || 'без пояснений';
}

// Время сброса лимита: из тела ошибки (resets_at / resets_in_seconds) или из заголовков.
export function rateLimitResetFrom(
  body: string,
  headers: Readonly<Record<string, string>>,
  now: Date = new Date(),
): Date | null {
  try {
    const data = JSON.parse(body) as { error?: Record<string, unknown> } & Record<string, unknown>;
    const source = data.error && typeof data.error === 'object' ? data.error : data;
    const resetsAt = Number(source['resets_at']);
    if (Number.isFinite(resetsAt) && resetsAt > 0) return new Date(resetsAt * 1000);
    const resetsIn = Number(source['resets_in_seconds']);
    if (Number.isFinite(resetsIn) && resetsIn > 0) return new Date(now.getTime() + resetsIn * 1000);
  } catch {
    // не JSON
  }
  for (const name of ['x-codex-primary-reset-after-seconds', 'retry-after']) {
    const seconds = Number(headers[name]);
    if (Number.isFinite(seconds) && seconds > 0) return new Date(now.getTime() + seconds * 1000);
  }
  return null;
}

function parseRateLimits(headers: Readonly<Record<string, string>>): LlmRateLimits | null {
  const primary = parseWindow(headers, 'primary');
  const secondary = parseWindow(headers, 'secondary');
  return primary || secondary ? { primary, secondary } : null;
}

function parseWindow(
  headers: Readonly<Record<string, string>>,
  which: 'primary' | 'secondary',
): LlmRateLimitWindow | null {
  const used = num(headers[`x-codex-${which}-used-percent`]);
  const minutes = num(headers[`x-codex-${which}-window-minutes`]);
  const resetAfter = num(headers[`x-codex-${which}-reset-after-seconds`]);
  const resetAt = num(headers[`x-codex-${which}-reset-at`]);
  if (used === null && minutes === null && resetAfter === null && resetAt === null) return null;
  return {
    usedPercent: used,
    windowMinutes: minutes,
    resetsAt:
      resetAt !== null
        ? new Date(resetAt * 1000)
        : resetAfter !== null
          ? new Date(Date.now() + resetAfter * 1000)
          : null,
  };
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type ExtractedResponse = {
  readonly text: string;
  readonly model: string | null;
  readonly usage: LlmUsage | null;
};

// Склеивает текст ответа из потока событий и достаёт расход токенов.
export function extractResponse(events: readonly SseEvent[], raw: string): ExtractedResponse {
  const deltas: string[] = [];
  const items: string[] = [];
  let usage: LlmUsage | null = null;
  let model: string | null = null;
  let incompleteReason: string | null = null;

  for (const event of events) {
    const type = event.type;
    if (type === 'error' || type === 'response.failed') {
      throw failureFromEvent(event);
    }
    if (type === 'response.output_text.delta' && typeof event['delta'] === 'string') {
      deltas.push(event['delta']);
    }
    if (type === 'response.output_item.done') {
      const text = textFromItem(event['item']);
      if (text) items.push(text);
    }
    if (type === 'response.completed' || type === 'response.incomplete') {
      const response = event['response'] as Record<string, unknown> | undefined;
      usage = usageFrom(response?.['usage']) ?? usage;
      if (typeof response?.['model'] === 'string') model = response['model'];
      if (type === 'response.incomplete') {
        const details = response?.['incomplete_details'] as { reason?: unknown } | undefined;
        incompleteReason = typeof details?.reason === 'string' ? details.reason : 'incomplete';
      }
    }
  }

  let text = (deltas.length > 0 ? deltas.join('') : items.join('')).trim();
  if (!text && events.length === 0) {
    // Бэкенд ответил обычным JSON вместо потока.
    try {
      const data = JSON.parse(raw) as { output_text?: unknown; output?: unknown; usage?: unknown; model?: unknown };
      if (typeof data.output_text === 'string') text = data.output_text.trim();
      else if (Array.isArray(data.output)) text = data.output.map(textFromItem).join('').trim();
      usage = usageFrom(data.usage);
      if (typeof data.model === 'string') model = data.model;
    } catch {
      // не JSON
    }
  }
  if (!text) {
    if (incompleteReason) throw new LlmUpstreamError(200, `ответ оборван (${incompleteReason})`);
    throw new LlmEmptyResponseError();
  }
  return { text, model, usage };
}

function failureFromEvent(event: SseEvent): Error {
  const response = event['response'] as { error?: { message?: unknown; code?: unknown } } | undefined;
  const nested = event['error'] as { message?: unknown; code?: unknown; type?: unknown } | undefined;
  const message =
    (typeof event['message'] === 'string' && event['message']) ||
    (typeof response?.error?.message === 'string' && response.error.message) ||
    (typeof nested?.message === 'string' && nested.message) ||
    'бэкенд вернул ошибку без пояснений';
  const code = String(response?.error?.code ?? nested?.code ?? nested?.type ?? '');
  if (/usage_limit|rate_limit|insufficient_quota/i.test(code) || /usage limit/i.test(message)) {
    return new LlmRateLimitedError(null, `Достигнут лимит подписки ChatGPT: ${message}`);
  }
  return new LlmUpstreamError(200, message);
}

function textFromItem(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const record = item as { type?: unknown; content?: unknown };
  if (record.type !== 'message' || !Array.isArray(record.content)) return '';
  return record.content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const { type, text } = part as { type?: unknown; text?: unknown };
      return (type === 'output_text' || type === 'text') && typeof text === 'string' ? text : '';
    })
    .join('');
}

function usageFrom(value: unknown): LlmUsage | null {
  if (!value || typeof value !== 'object') return null;
  const u = value as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
    output_tokens_details?: { reasoning_tokens?: unknown };
  };
  const toInt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  return {
    inputTokens: toInt(u.input_tokens),
    cachedInputTokens: toInt(u.input_tokens_details?.cached_tokens),
    outputTokens: toInt(u.output_tokens),
    reasoningTokens: toInt(u.output_tokens_details?.reasoning_tokens),
  };
}
