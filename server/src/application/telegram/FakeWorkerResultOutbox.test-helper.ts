import type { TelegramWorkerResultOutbox, WorkerResultDelivery, WorkerCompletion } from './TelegramWorkerResultOutbox.js';

export class FakeWorkerResultOutbox implements TelegramWorkerResultOutbox {
  completion: WorkerCompletion | null = { key: 'session:first', startedAt: new Date('2026-10-20T09:00:00Z') };
  recoverable: string[] = [];
  readonly rows = new Map<string, WorkerResultDelivery & { sent?: Date; retry?: Date; token?: string; until?: Date }>();
  async findCompletion() { return this.completion; }
  async listRecoverable() { return this.recoverable; }
  async enqueue(d: WorkerResultDelivery) {
    if (![...this.rows.values()].some((r) => r.taskId === d.taskId && r.completionKey === d.completionKey)) this.rows.set(d.id, { ...d });
  }
  async listDue(now: Date) { return [...this.rows.values()].filter((r) => !r.sent && (!r.retry || r.retry <= now) && (!r.until || r.until <= now)); }
  async claim(id: string, token: string, now: Date, until: Date) {
    const r = this.rows.get(id);
    if (!r || r.sent || (r.retry && r.retry > now) || (r.until && r.until > now)) return false;
    r.token = token; r.until = until; return true;
  }
  async finish(id: string, token: string, now: Date) {
    const r = this.rows.get(id);
    if (r?.token === token) { r.sent = now; r.token = undefined; r.until = undefined; }
  }
  async retry(id: string, token: string, at: Date) {
    const r = this.rows.get(id);
    if (r?.token === token) { r.retry = at; r.token = undefined; r.until = undefined; }
  }
}
