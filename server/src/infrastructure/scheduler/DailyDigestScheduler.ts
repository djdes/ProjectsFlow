import type { DigestSettingsRepository } from '../../application/digest/DigestSettingsRepository.js';
import type { SendDailyDigest } from '../../application/digest/SendDailyDigest.js';

// «Сейчас» в Europe/Moscow → { hour 0..23, minute 0..59, date 'YYYY-MM-DD' }.
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
    hour: Number(get('hour')) % 24, // некоторые среды дают "24" для полуночи
    minute: Number(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// Серверный планировщик ежедневной сводки. Тик раз в минуту: для каждого проекта с
// включённой сводкой — если МSK-время уже наступило и сегодня ещё не слали, отправляет
// и помечает дату. Catch-up: первый тик сразу при старте (на случай рестарта после времени).
export class DailyDigestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: { settings: DigestSettingsRepository; send: SendDailyDigest },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e) => console.warn('[daily-digest] tick error', e));
    }, 60_000);
    void this.tick().catch((e) => console.warn('[daily-digest] tick error', e));
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
    // День недели МSK-даты (0=Вс..6=Сб). new Date(Y,M-1,D) — календарная дата, weekday
    // от tz не зависит; берём компоненты из уже посчитанной МSK-даты.
    const [y, m, d] = now.date.split('-').map(Number);
    const dow = new Date(y!, (m ?? 1) - 1, d!).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const due = await this.deps.settings.listDailyEnabled();
    for (const s of due) {
      // «Только по будням»: в выходные не шлём (кому надо — отправят вручную «Сейчас»).
      if (s.daily.weekdaysOnly && isWeekend) continue;
      const schedMin = s.daily.hour * 60 + s.daily.minute;
      if (nowMin < schedMin || s.dailyLastSentOn === now.date) continue;
      try {
        await this.deps.send.execute(s.projectId);
      } catch (e) {
        console.warn('[daily-digest] send failed', s.projectId, e);
      } finally {
        // Помечаем отправленным в любом случае — чтобы не ретраить каждую минуту.
        await this.deps.settings.markDailySent(s.projectId, now.date).catch(() => {});
      }
    }
  }
}
