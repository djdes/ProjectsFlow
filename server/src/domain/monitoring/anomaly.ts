// Детектор аномалий по числовому ряду метрики: rolling baseline (mean+σ). Флаг — когда
// последние minConsecutive точек устойчиво выше mean + k·σ (адаптивно к конкретному серверу,
// без ручных порогов). Консервативно (k=3, 3 подряд) — ловим ползущую деградацию, не шумим.

export type AnomalyResult = {
  readonly isAnomaly: boolean;
  readonly mean: number;
  readonly stddev: number;
  readonly last: number;
};

export type AnomalyOpts = {
  readonly k: number; // во сколько σ отклонение считаем аномалией
  readonly minConsecutive: number; // сколько последних точек должны превышать порог
  readonly minPoints: number; // минимум точек для надёжного baseline
};

export function detectAnomaly(
  values: ReadonlyArray<number | null>,
  opts: AnomalyOpts,
): AnomalyResult | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < opts.minPoints) return null;

  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const stddev = Math.sqrt(variance);
  // Плоский ряд (σ≈0) → отклонений нет смысла искать (иначе любой джиттер = аномалия).
  if (stddev < 1e-6) return null;

  const threshold = mean + opts.k * stddev;
  const recent = nums.slice(-opts.minConsecutive);
  const isAnomaly = recent.length === opts.minConsecutive && recent.every((v) => v > threshold);
  return { isAnomaly, mean, stddev, last: nums[nums.length - 1]! };
}
