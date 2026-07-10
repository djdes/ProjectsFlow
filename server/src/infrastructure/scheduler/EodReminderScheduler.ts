import type { AutomationRepository } from '../../application/automation/AutomationRepository.js';
import type { SendEodReminder } from '../../application/eod/SendEodReminder.js';

// «Сейчас» в Europe/Moscow → { hour, minute, date 'YYYY-MM-DD' }. Зеркало CommitSyncScheduler.
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

// Планировщик EOD-напоминаний (db/101, Фаза 2). Тик раз в минуту: по каждому проекту с
// включённым eod_reminder — если МSK-время наступило и сегодня ещё не слали — шлёт напоминание
// и помечает дату. Catch-up: первый тик сразу при старте. Детерминирован (без раннера).
export class EodReminderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly deps: { automation: AutomationRepository; send: SendEodReminder },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e) => console.warn('[eod-reminder] tick error', e));
    }, 60_000);
    void this.tick().catch((e) => console.warn('[eod-reminder] tick error', e));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runTick();
    } finally {
      this.running = false;
    }
  }

  private async runTick(): Promise<void> {
    const now = mskNow();
    const nowMin = now.hour * 60 + now.minute;
    const due = await this.deps.automation.listEodReminderEnabled();
    for (const s of due) {
      const schedMin = s.hour * 60 + s.minute;
      if (nowMin < schedMin || s.lastRunOn === now.date) continue;
      try {
        await this.deps.send.execute(s.projectId);
      } catch (e) {
        console.warn('[eod-reminder] send failed', s.projectId, e);
      } finally {
        // Помечаем в любом случае — чтобы не ретраить каждую минуту (как digest/commit-sync).
        await this.deps.automation.markEodReminderRun(s.projectId, now.date).catch(() => {});
      }
    }
  }
}
