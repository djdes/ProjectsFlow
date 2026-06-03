// Линейный прогноз исчерпания ресурса по тренду (least-squares slope value vs время в днях).
// Возвращает темп (%/день) и ETA (дней) до target. null — данных мало или ресурс не растёт.

export type Forecast = {
  readonly ratePerDay: number; // прирост значения в день (%)
  readonly etaDays: number; // дней до достижения target при текущем темпе
  readonly last: number; // последнее значение
};

const DAY_MS = 24 * 3600 * 1000;

export function forecast(
  points: ReadonlyArray<{ collectedAt: Date; value: number | null }>,
  target: number,
): Forecast | null {
  const pts = points
    .filter((p): p is { collectedAt: Date; value: number } => typeof p.value === 'number')
    .map((p) => ({ t: p.collectedAt.getTime(), v: p.value }));
  if (pts.length < 8) return null; // мало данных для тренда

  const t0 = pts[0]!.t;
  const xs = pts.map((p) => (p.t - t0) / DAY_MS); // дни от начала окна
  const ys = pts.map((p) => p.v);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i]!, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom; // %/день
  const last = ys[ys.length - 1]!;

  // Рост незначим (≤0.05%/день) или ресурс уже за target → прогноз не показываем.
  if (slope <= 0.05 || last >= target) return null;
  const etaDays = (target - last) / slope;
  if (!Number.isFinite(etaDays) || etaDays <= 0 || etaDays > 3650) return null;
  return { ratePerDay: slope, etaDays, last };
}
