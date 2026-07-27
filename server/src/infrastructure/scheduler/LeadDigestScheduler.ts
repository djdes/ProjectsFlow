import type { LeadDigestStateRepository } from '../../application/lead/LeadDigestStateRepository.js';
import type { SendLeadDigest } from '../../application/lead/SendLeadDigest.js';
import { mskNow } from './mskClock.js';

// Час утренней сводки руководителю (МСК). Настройки времени в этой итерации нет — оно
// совпадает с началом рабочего дня; см. «Что осталось за рамками» в спеке.
const DIGEST_HOUR = 9;

/**
 * Ежедневная личная сводка руководителям каждого пространства, где они назначены.
 *
 * Тик раз в минуту; отправка идёт в первый тик после 09:00 МСК и ровно один раз в день
 * (дата последней отправки лежит в lead_digest_state, поэтому рестарт процесса не приводит
 * к дублю). Ошибка по одному пространству не останавливает остальные.
 */
export class LeadDigestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      readonly state: LeadDigestStateRepository;
      readonly send: SendLeadDigest;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => console.warn('[lead-digest] tick failed', error));
    }, 60_000);
    void this.tick().catch((error) => console.warn('[lead-digest] tick failed', error));
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(at: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = mskNow(at);
      if (now.hour < DIGEST_HOUR) return;
      const workspaces = await this.deps.state.listWorkspacesWithLeads();
      for (const ws of workspaces) {
        if (ws.lastSentOn === now.date) continue;
        try {
          await this.deps.send.execute(ws.workspaceId);
        } catch (error) {
          console.warn('[lead-digest] send failed', ws.workspaceId, error);
        } finally {
          // Отметку ставим и после ошибки: повтор каждую минуту хуже пропуска одного дня.
          await this.deps.state.markSent(ws.workspaceId, now.date).catch(() => undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
