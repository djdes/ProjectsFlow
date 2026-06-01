export class ServerNotFoundError extends Error {
  constructor() {
    super('server not found');
    this.name = 'ServerNotFoundError';
  }
}

export class ServerNameInvalidError extends Error {
  constructor(message = 'server name invalid') {
    super(message);
    this.name = 'ServerNameInvalidError';
  }
}

export class SnapshotIngestInvalidError extends Error {
  constructor(public readonly reason: string) {
    super(`snapshot ingest invalid: ${reason}`);
    this.name = 'SnapshotIngestInvalidError';
  }
}

export class LocalServerCollectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalServerCollectError';
  }
}

// Попытка on-demand local-collect'а для не-local сервера (remote собирает агент).
export class NotLocalServerError extends Error {
  constructor() {
    super('on-demand collect is only available for local servers');
    this.name = 'NotLocalServerError';
  }
}

export class LogPathNotAllowedError extends Error {
  constructor(public readonly path: string) {
    super(`log path not allowed: ${path}`);
    this.name = 'LogPathNotAllowedError';
  }
}
