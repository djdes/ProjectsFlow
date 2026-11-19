// Прогноз дневного ряда метрики на horizon дней вперёд: линейный тренд по последним
// TREND_WINDOW дням плюс поправка на день недели (по средним остаткам), вилка — ±1.96σ
// остатков (≈95%). Метрики платформы маленькие и шумные, поэтому модель намеренно простая:
// её легко объяснить на графике, и она не «придумывает» сезонность, которой нет в данных.

export type DailyPoint = { readonly day: string; readonly value: number };
export type ForecastPoint = { readonly day: string; readonly value: number; readonly low: number; readonly high: number };

const TREND_WINDOW = 56;
const MIN_POINTS = 14;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function forecastDaily(series: readonly DailyPoint[], horizon = 30): ForecastPoint[] {
  const points = series.slice(-TREND_WINDOW);
  const last = series[series.length - 1];
  if (points.length < MIN_POINTS || !last) return [];
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value);
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
    sxx += (xs[i]! - meanX) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const trend = (i: number): number => intercept + slope * i;

  // Поправка дня недели — средний остаток тренда по этому дню.
  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  points.forEach((p, i) => {
    const w = weekday(p.day);
    sums[w]! += p.value - trend(i);
    counts[w]! += 1;
  });
  const season = sums.map((s, w) => (counts[w] ? s / counts[w]! : 0));

  const residuals = points.map((p, i) => p.value - trend(i) - season[weekday(p.day)]!);
  const sigma = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2));
  const band = 1.96 * sigma;

  const out: ForecastPoint[] = [];
  for (let k = 1; k <= horizon; k += 1) {
    const day = addDays(last.day, k);
    const raw = trend(n - 1 + k) + season[weekday(day)]!;
    const value = Math.max(0, raw);
    out.push({ day, value: round1(value), low: round1(Math.max(0, raw - band)), high: round1(Math.max(0, raw + band)) });
  }
  return out;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// Ряд с нулями в днях без событий: SQL отдаёт только дни, где что-то было.
export function fillDays(from: string, to: string, values: ReadonlyMap<string, number>): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push({ day, value: values.get(day) ?? 0 });
  return out;
}
