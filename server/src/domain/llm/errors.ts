// Ошибки LLM-модуля. Сообщения — для людей (админка, ответ шлюза в codex), коды — в
// errorHandler/шлюзе.

// Подключение для запроса не найдено (вход по коду ещё не выполнен или отключён).
export class LlmNotConnectedError extends Error {
  constructor() {
    super('ИИ не подключён: войдите в подписку ChatGPT по коду в админке.');
    this.name = 'LlmNotConnectedError';
  }
}

// Провайдер отверг токены — нужен повторный вход по коду.
export class LlmReauthRequiredError extends Error {
  constructor(
    readonly connectionId: string,
    readonly reason: string,
  ) {
    super(`Подписка ChatGPT требует повторного входа по коду (${reason}).`);
    this.name = 'LlmReauthRequiredError';
  }
}

// Провайдер отверг refresh-токен (истёк, отозван или уже использован).
export class LlmRefreshRejectedError extends Error {
  constructor(readonly code: string) {
    super(`Refresh token rejected: ${code}`);
    this.name = 'LlmRefreshRejectedError';
  }
}

// 401 от провайдера на запрос с access-токеном: сервис доступа обновит токен и повторит.
export class LlmUnauthorizedError extends Error {
  constructor(message = 'Provider rejected the access token (401)') {
    super(message);
    this.name = 'LlmUnauthorizedError';
  }
}

// Упор в лимит подписки или в частоту запросов (429).
export class LlmRateLimitedError extends Error {
  constructor(
    readonly resetsAt: Date | null,
    message = 'Достигнут лимит подписки ChatGPT — повторите позже.',
  ) {
    super(message);
    this.name = 'LlmRateLimitedError';
  }
}

// 403 от провайдера: чаще всего блокировка по IP или региону, а не ошибка настроек.
export class LlmUpstreamBlockedError extends Error {
  constructor(readonly detail: string) {
    super(`Доступ к ChatGPT закрыт (HTTP 403): ${detail}`);
    this.name = 'LlmUpstreamBlockedError';
  }
}

export class LlmUpstreamError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`ChatGPT ответил HTTP ${status}: ${detail}`);
    this.name = 'LlmUpstreamError';
  }
}

export class LlmEmptyResponseError extends Error {
  constructor() {
    super('ChatGPT вернул пустой ответ');
    this.name = 'LlmEmptyResponseError';
  }
}

// Вход по коду не включён для аккаунта (провайдер отвечает 404 на запрос кода).
export class LlmDeviceAuthUnavailableError extends Error {
  constructor() {
    super(
      'Вход по коду не включён: в ChatGPT откройте Settings → Security и включите вход по коду для Codex (в рабочем пространстве это делает его администратор).',
    );
    this.name = 'LlmDeviceAuthUnavailableError';
  }
}

export class LlmDeviceLoginNotFoundError extends Error {
  constructor() {
    super('Нет незавершённого входа по коду — начните заново.');
    this.name = 'LlmDeviceLoginNotFoundError';
  }
}

export class LlmInvalidSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmInvalidSettingsError';
  }
}
