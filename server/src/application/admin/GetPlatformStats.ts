import { fillDays, forecastDaily, type DailyPoint, type ForecastPoint } from '../../domain/stats/forecast.js';
import type { DailyCounts, PlatformStatsRepository, PlatformTotals } from './PlatformStatsRepository.js';

export type StatsMetricKey = 'activeUsers' | 'registrations' | 'tasksCreated' | 'comments';

export type StatsMetric = {
  readonly key: StatsMetricKey;
  readonly label: string;
  readonly points: DailyPoint[];
  readonly forecast: ForecastPoint[];
  // Сумма за последние 30 завершённых дней и за 30 дней до них — для «±% к прошлому периоду».
  readonly last30: number;
  readonly prev30: number;
  readonly forecastNext30: number;
};

export type PlatformStats = {
  readonly from: string;
  readonly to: string;
  readonly totals: PlatformTotals;
  readonly metrics: StatsMetric[];
};

const HISTORY_DAYS = 120;
const HORIZON = 30;

// Москва без перехода на летнее время — день считаем по UTC+3, как и SQL.
function moscowDay(date: Date): string {
  return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Вкладка «Статистика» админки: дневные ряды метрик платформы за 120 дней, итоги и прогноз
// на 30 дней (forecastDaily). Сегодняшний неполный день в прогноз и сравнение не входит.
export class GetPlatformStats {
  constructor(private readonly deps: { readonly repo: PlatformStatsRepository; readonly now: () => Date }) {}

  async execute(): Promise<PlatformStats> {
    const now = this.deps.now();
    const to = moscowDay(now);
    const from = shiftDay(to, -(HISTORY_DAYS - 1));
    const [registrations, activeUsers, tasksCreated, comments, totals] = await Promise.all([
      this.deps.repo.registrationsByDay(from),
      this.deps.repo.activeUsersByDay(from),
      this.deps.repo.tasksCreatedByDay(from),
      this.deps.repo.commentsByDay(from),
      this.deps.repo.totals(now),
    ]);
    const lastFull = shiftDay(to, -1);
    const sum = (list: readonly DailyPoint[]): number => list.reduce((a, p) => a + p.value, 0);
    const metric = (key: StatsMetricKey, label: string, counts: DailyCounts): StatsMetric => {
      const points = fillDays(from, to, counts);
      const full = points.filter((p) => p.day <= lastFull);
      const forecast = forecastDaily(full, HORIZON);
      return {
        key,
        label,
        points,
        forecast,
        last30: sum(full.slice(-30)),
        prev30: sum(full.slice(-60, -30)),
        forecastNext30: Math.round(sum(forecast)),
      };
    };
    return {
      from,
      to,
      totals,
      metrics: [
        metric('activeUsers', 'Активные пользователи', activeUsers),
        metric('registrations', 'Регистрации', registrations),
        metric('tasksCreated', 'Создано задач', tasksCreated),
        metric('comments', 'Комментарии', comments),
      ],
    };
  }
}
