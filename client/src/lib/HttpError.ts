// HttpError — cross-layer тип ошибки HTTP. Живёт в lib, чтобы presentation
// мог type-check'ать ошибки от репозиториев без нарушения boundaries.

export type HttpErrorBody = { error: string; message?: string; details?: unknown };

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: HttpErrorBody,
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
    this.name = 'HttpError';
  }
}
