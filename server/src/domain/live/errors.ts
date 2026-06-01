// Доменные ошибки LIVE-стриминга. Мапятся в HTTP-статусы в presentation/middleware/errorHandler.ts.

export class LiveSessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Live session not found: ${sessionId}`);
    this.name = 'LiveSessionNotFoundError';
  }
}

// Сессия завершилась слишком давно (за пределами окна live-стрима) — клиент должен
// читать историю через GET .../events, а не держать SSE-коннект. Мапится в 410 Gone.
export class LiveSessionGoneError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Live session ended and is no longer streamable: ${sessionId}`);
    this.name = 'LiveSessionGoneError';
  }
}
