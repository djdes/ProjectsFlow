import type { AutomationRepository } from '../../application/automation/AutomationRepository.js';
import type { EnqueueCommitSyncJob } from '../../application/commit-sync/EnqueueCommitSyncJob.js';

// «Сейчас» в Europe/Moscow → { hour 0..23, minute 0..59, date 'YYYY-MM-DD' }.
// Зеркало DailyDigestScheduler.mskNow.
function mskNow(): { hour: number; minute: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return {
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// Серверный планировщик ежедневной commit-sync. Тик раз в минуту: для каждого проекта с
// включённым commit-sync — если МSK-время уже наступило и сегодня ещё не запускались,
// ставит job и помечает дату. Catch-up: первый тик сразу при старте (рестарт после времени).
export class CommitSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: { automation: AutomationRepository; enqueue: EnqueueCommitSyncJob },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e) => console.warn('[commit-sync] tick error', e));
    }, 60_000);
    void this.tick().catch((e) => console.warn('[commit-sync] tick error', e));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    const now = mskNow();
    const nowMin = now.hour * 60 + now.minute;
    const due = await this.deps.automation.listCommitSyncEnabled();
    for (const s of due) {
      const schedMin = s.hour * 60 + s.minute;
      if (nowMin < schedMin || s.lastRunOn === now.date) continue;
      try {
        await this.deps.enqueue.execute(s.projectId);
      } catch (e) {
        console.warn('[commit-sync] enqueue failed', s.projectId, e);
      } finally {
        // Помечаем запуск в любом случае — чтобы не ретраить каждую минуту (как digest).
        await this.deps.automation.markCommitSyncRun(s.projectId, now.date).catch(() => {});
      }
    }
  }
}
