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
