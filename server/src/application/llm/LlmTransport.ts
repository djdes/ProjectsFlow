// Транспорт к модели в формате Responses API.

export type LlmAccess = {
  readonly accessToken: string;
  readonly accountId: string | null;
};

export type LlmReasoningEffort = 'low' | 'medium' | 'high';

// Строгий JSON-ответ по схеме (Responses API, text.format json_schema): модель не может вернуть
// битый JSON или пропустить обязательные поля.
export type LlmJsonSchema = {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
};

export type LlmTextRequest = {
  readonly model: string;
  // Системная инструкция (роль, правила, формат ответа).
  readonly instructions: string;
  // Сообщение пользователя: данные задания.
  readonly input: string;
  readonly reasoningEffort: LlmReasoningEffort;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly jsonSchema?: LlmJsonSchema;
};

export type LlmUsage = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
};

// Окно лимита подписки из заголовков ответа провайдера (если он их прислал).
export type LlmRateLimitWindow = {
  readonly usedPercent: number | null;
  readonly windowMinutes: number | null;
  readonly resetsAt: Date | null;
};

export type LlmRateLimits = {
  readonly primary: LlmRateLimitWindow | null;
  readonly secondary: LlmRateLimitWindow | null;
};

export type LlmTextResult = {
  readonly text: string;
  readonly model: string;
  readonly usage: LlmUsage | null;
  readonly rateLimits: LlmRateLimits | null;
};

// Сырой запрос шлюза: тело от codex передаётся как есть.
export type LlmRawRequest = {
  // Подпуть после /responses: '' или '/compact'.
  readonly subpath: string;
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  // Для потокового ответа: каждый готовый элемент вывода модели (response.output_item.done)
  // проходит через эту функцию; вернула объект — элемент заменяется, null — уходит как есть.
  readonly transformOutputItem?: (item: unknown) => Record<string, unknown> | null;
};

export type LlmRawResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ReadableStream<Uint8Array> | null;
  // Для 429: до какого времени подписка в лимите (транспорт разбирает ответ провайдера).
  readonly rateLimitResetsAt?: Date | null;
  // Для ошибок (не 2xx): короткое описание из тела ответа — для статуса подключения.
  readonly errorDetail?: string | null;
};

export type LlmTransport = {
  // Бросает LlmUnauthorizedError (401), LlmRateLimitedError (429), LlmUpstreamBlockedError (403),
  // LlmUpstreamError (прочее), LlmEmptyResponseError.
  generateText(access: LlmAccess, request: LlmTextRequest): Promise<LlmTextResult>;
  // Проксирование для шлюза: статус и поток ответа отдаются вызывающему без разбора.
  forward(access: LlmAccess, request: LlmRawRequest): Promise<LlmRawResponse>;
};
