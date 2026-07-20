// Ошибки подсистемы app-backend (пользовательские приложения). Presentation маппит их на
// HTTP-коды: NotProvisioned→404, QuotaExceeded→413, SchemaInvalid/TableNotAllowed→400,
// UserExists→409, Auth→401, AccessDenied→403.

export class AppBackendNotProvisionedError extends Error {
  constructor(public readonly projectId: string) {
    super(`App backend not provisioned for project ${projectId}`);
    this.name = 'AppBackendNotProvisionedError';
  }
}

export class StorageQuotaExceededError extends Error {
  constructor(
    public readonly usageBytes: number,
    public readonly limitBytes: number,
  ) {
    super(`Storage quota exceeded: ${usageBytes} >= ${limitBytes} bytes`);
    this.name = 'StorageQuotaExceededError';
  }
}

export class AppSchemaInvalidError extends Error {
  constructor(message: string) {
    super(`Invalid app schema: ${message}`);
    this.name = 'AppSchemaInvalidError';
  }
}

export class AppTableNotAllowedError extends Error {
  constructor(public readonly table: string) {
    super(`Table not in app schema: ${table}`);
    this.name = 'AppTableNotAllowedError';
  }
}

export class AppUserExistsError extends Error {
  constructor() {
    super('App user with this email already exists');
    this.name = 'AppUserExistsError';
  }
}

export class AppAuthError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AppAuthError';
  }
}

export class AppAccessDeniedError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'AppAccessDeniedError';
  }
}

// Нарушение UNIQUE-ограничения при записи в per-project базу. Инфраструктура (SQLite-стор)
// поднимает эту типизированную ошибку вместо сырого драйверного исключения, чтобы прикладной
// слой мог решить, как ответить. `columns` — затронутые UNIQUE-колонки (для проверки на
// чувствительность и записи в аудит); наружу, в HTTP-ответ, имена колонок НЕ отдаём.
export class AppUniqueViolationError extends Error {
  constructor(
    public readonly table: string,
    public readonly columns: readonly string[],
  ) {
    super(`Unique constraint violated on ${table}`);
    this.name = 'AppUniqueViolationError';
  }
}

// Нейтральный ответ на конфликт уникальности: без имени колонки и без значения. Нужен, чтобы
// UNIQUE-конфликт по чувствительной колонке не работал как бесшумный оракул существования
// секрета (проверка существования по значению не должна ни подтверждаться текстом ошибки, ни
// проходить без следа в аудите). Presentation маппит на 409.
export class AppDuplicateValueError extends Error {
  constructor(public readonly table: string) {
    super('A record with these values already exists');
    this.name = 'AppDuplicateValueError';
  }
}

// Optimistic concurrency (долг 0.1): строку изменил другой участник между открытием и сохранением.
// currentRow — актуальная (маскированная) версия строки, чтобы UI обновил базовую версию, не теряя
// введённого. Presentation маппит на 409.
export class AppRowConflictError extends Error {
  constructor(
    public readonly table: string,
    public readonly rowId: string,
    public readonly currentRow: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(`Row ${rowId} in ${table} was modified by another editor`);
    this.name = 'AppRowConflictError';
  }
}
