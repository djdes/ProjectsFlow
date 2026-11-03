import { useEffect, useId, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/skeleton';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { cn } from '@/lib/utils';
import type { PlatformStats, PlatformStatsMetric, StatsForecastPoint, StatsPoint } from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';

type Range = '30' | '90' | '120';
const RANGES = [
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '120', label: '120 дней' },
] as const;

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDay = (day: string): string => dayFmt.format(new Date(`${day}T00:00:00Z`));

// Вкладка «Статистика» админки: итоги платформы и дневные ряды с прогнозом на 30 дней.
// Метрики разного масштаба — каждая на своём графике (без двух осей на одном).
export function AdminStatsPanel(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('90');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminRepository
      .getPlatformStats()
      .then((s) => {
        if (!cancelled) {
          setStats(s);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(actionErrorMessage(e, 'Не удалось загрузить статистику'));
      });
    return () => {
      cancelled = true;
    };
  }, [adminRepository, reload]);

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm text-destructive">
        {error}
        <Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw className="size-4" /> Повторить
        </Button>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    );
  }

  const t = stats.totals;
  const tiles: { label: string; value: number; hint?: string }[] = [
    { label: 'Пользователей', value: t.users },
    { label: 'Активны за 7 дней', value: t.activeWeek, hint: `${share(t.activeWeek, t.users)} от всех` },
    { label: 'Активны за 30 дней', value: t.activeMonth, hint: `${share(t.activeMonth, t.users)} от всех` },
    { label: 'Платные тарифы', value: t.paidUsers },
    { label: 'Пространств', value: t.workspaces },
    { label: 'Проектов', value: t.projects },
    { label: 'Задач', value: t.tasks },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((tile) => (
          <li key={tile.label} className="rounded-xl bg-card p-3 shadow-card">
            <p className="text-meta text-muted-foreground">{tile.label}</p>
            <p className="mbs-0.5 text-title font-semibold tabular-nums">{nf.format(tile.value)}</p>
            {tile.hint && <p className="text-2xs text-muted-foreground">{tile.hint}</p>}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" options={RANGES} value={range} onChange={setRange} />
        <span className="text-meta text-muted-foreground">
          История по дням (Москва) и прогноз на 30 дней: тренд с поправкой на день недели, полоса — вероятный разброс.
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {stats.metrics.map((m) => (
          <MetricCard key={m.key} metric={m} days={Number(range)} />
        ))}
      </div>
    </div>
  );
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

function MetricCard({ metric, days }: { metric: PlatformStatsMetric; days: number }): React.ReactElement {
  const [table, setTable] = useState(false);
  const history = metric.points.slice(-days);
  const delta = metric.prev30 > 0 ? Math.round(((metric.last30 - metric.prev30) / metric.prev30) * 100) : null;
  return (
    <section aria-label={metric.label} className="rounded-xl bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-ui font-semibold">{metric.label}</h3>
        <span className="text-meta text-muted-foreground">
          за 30 дней: <span className="font-medium text-foreground tabular-nums">{nf.format(metric.last30)}</span>
          {delta !== null && (
            <span className={cn('ms-1 tabular-nums', delta >= 0 ? 'text-done' : 'text-destructive')}>
              {delta >= 0 ? '+' : ''}
              {delta}%
            </span>
          )}
        </span>
        <span className="text-meta text-muted-foreground">
          прогноз на 30 дней:{' '}
          <span className="font-medium text-foreground tabular-nums">
            {metric.forecast.length ? `≈ ${nf.format(metric.forecastNext30)}` : 'мало данных'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setTable((v) => !v)}
          className="ms-auto text-meta text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {table ? 'График' : 'Таблица'}
        </button>
      </div>
      {table ? (
        <StatsTable history={history} forecast={metric.forecast} />
      ) : (
        <TrendChart history={history} forecast={metric.forecast} label={metric.label} />
      )}
    </section>
  );
}

function StatsTable({ history, forecast }: { history: StatsPoint[]; forecast: StatsForecastPoint[] }): React.ReactElement {
  return (
    <div className="mbs-3 max-h-60 overflow-y-auto">
      <table className="w-full text-meta tabular-nums">
        <thead className="sticky inset-bs-0 bg-card text-muted-foreground">
          <tr>
            <th className="py-1 text-start font-medium">День</th>
            <th className="py-1 text-end font-medium">Значение</th>
            <th className="py-1 text-end font-medium">Прогноз (вилка)</th>
          </tr>
        </thead>
        <tbody>
          {[...forecast].reverse().map((p) => (
            <tr key={p.day} className="text-muted-foreground">
              <td className="py-0.5">{fmtDay(p.day)}</td>
              <td />
              <td className="text-end">
                {nf.format(p.value)} ({nf.format(p.low)}–{nf.format(p.high)})
              </td>
            </tr>
          ))}
          {[...history].reverse().map((p) => (
            <tr key={p.day}>
              <td className="py-0.5">{fmtDay(p.day)}</td>
              <td className="text-end">{nf.format(p.value)}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const W = 600;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 34 };

// Линия истории (сплошная), прогноз (пунктир) и полоса вероятного разброса. Одна серия на
// график — подпись графика и есть легенда. Наведение — перекрестие и подсказка по дню.
function TrendChart({
  history,
  forecast,
  label,
}: {
  history: StatsPoint[];
  forecast: StatsForecastPoint[];
  label: string;
}): React.ReactElement {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const all = useMemo(
    () => [
      ...history.map((p) => ({ ...p, kind: 'history' as const })),
      ...forecast.map((p) => ({ ...p, kind: 'forecast' as const })),
    ],
    [history, forecast],
  );
  const maxY = Math.max(1, ...history.map((p) => p.value), ...forecast.map((p) => p.high));
  const niceMax = niceCeil(maxY);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number): number => PAD.left + (all.length <= 1 ? 0 : (i / (all.length - 1)) * innerW);
  const y = (v: number): number => PAD.top + innerH - (v / niceMax) * innerH;
  const histPath = history.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const lastHist = history.length - 1;
  const fcStart = lastHist >= 0 && history[lastHist] ? `M${x(lastHist).toFixed(1)},${y(history[lastHist]!.value).toFixed(1)}` : '';
  const fcPath =
    fcStart + forecast.map((p, k) => `L${x(lastHist + 1 + k).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const band =
    forecast.length > 0
      ? forecast.map((p, k) => `${k ? 'L' : 'M'}${x(lastHist + 1 + k).toFixed(1)},${y(p.high).toFixed(1)}`).join('') +
        [...forecast]
          .reverse()
          .map((p, k) => `L${x(lastHist + forecast.length - k).toFixed(1)},${y(p.low).toFixed(1)}`)
          .join('') +
        'Z'
      : '';
  const ticks = [0, niceMax / 2, niceMax];
  const labelEvery = Math.max(1, Math.ceil(all.length / 6));
  const point = hover !== null ? all[hover] : null;

  const onMove = (event: React.PointerEvent<SVGRectElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rel = (event.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(all.length - 1, Math.round(rel * (all.length - 1)))));
  };

  return (
    <div className="relative mbs-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: история за ${history.length} дней и прогноз на ${forecast.length} дней`}
        className="block h-auto w-full text-primary"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {nf.format(v)}
            </text>
          </g>
        ))}
        {all.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.day} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {fmtDay(p.day)}
            </text>
          ) : null,
        )}
        {forecast.length > 0 && (
          <line
            x1={x(lastHist)}
            x2={x(lastHist)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            className="stroke-muted-foreground/40"
            strokeDasharray="2 3"
          />
        )}
        <g clipPath={`url(#${clipId})`}>
          {band && <path d={band} fill="currentColor" fillOpacity={0.12} />}
          <path d={histPath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {fcPath && (
            <path d={fcPath} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
          )}
        </g>
        {point && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-foreground/30" />
            <circle cx={x(hover)} cy={y(point.value)} r={4} fill="currentColor" className="stroke-card" strokeWidth={2} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {point && hover !== null && (
        <div
          className="pointer-events-none absolute inset-bs-0 rounded-md bg-popover px-2 py-1 text-meta shadow-menu"
          style={{
            insetInlineStart: `${(x(hover) / W) * 100}%`,
            transform: hover > all.length / 2 ? 'translateX(-105%)' : 'translateX(5%)',
          }}
        >
          <p className="text-muted-foreground">
            {fmtDay(point.day)}
            {point.kind === 'forecast' ? ' · прогноз' : ''}
          </p>
          <p className="font-medium tabular-nums text-foreground">
            {nf.format(point.value)}
            {point.kind === 'forecast' && 'low' in point
              ? ` (${nf.format(point.low)}–${nf.format(point.high)})`
              : ''}
          </p>
        </div>
      )}
    </div>
  );
}

function niceCeil(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
