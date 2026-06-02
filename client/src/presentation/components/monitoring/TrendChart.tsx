import { useMemo } from 'react';

// Рукодельный SVG-sparkline (без чарт-либ — CLAUDE.md #8). Рисует линию + заливку,
// подписывает последнее значение. Пропуски (null) разрывают линию.
export function TrendChart({
  label,
  values,
  max,
  suffix = '',
  color = 'hsl(var(--primary))',
}: {
  label: string;
  values: ReadonlyArray<number | null>;
  max?: number;
  suffix?: string;
  color?: string;
}): React.ReactElement {
  const W = 240;
  const H = 44;
  const pad = 2;

  const { path, area, last, lo, hi } = useMemo(() => {
    const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length === 0) {
      return { path: '', area: '', last: null as number | null, lo: null as number | null, hi: null as number | null };
    }
    const dataMax = max ?? Math.max(...nums, 1);
    const dataMin = Math.min(...nums, 0);
    const span = dataMax - dataMin || 1;
    const n = values.length;
    const x = (i: number): number => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
    const y = (v: number): number => H - pad - ((v - dataMin) / span) * (H - 2 * pad);

    // Сегменты линии с разрывами на null.
    const segs: string[] = [];
    let cur: string[] = [];
    values.forEach((v, i) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        cur.push(`${cur.length === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      } else if (cur.length) {
        segs.push(cur.join(' '));
        cur = [];
      }
    });
    if (cur.length) segs.push(cur.join(' '));

    // Площадь — по последнему непрерывному отрезку (достаточно для фоновой заливки).
    let areaPath = '';
    const firstIdx = values.findIndex((v) => typeof v === 'number');
    const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => typeof v === 'number');
    if (firstIdx >= 0 && segs.length) {
      areaPath = `${segs[segs.length - 1]} L${x(lastIdx).toFixed(1)},${H - pad} L${x(firstIdx).toFixed(1)},${H - pad} Z`;
    }

    const lastVal = nums[nums.length - 1] ?? null;
    return { path: segs.join(' '), area: areaPath, last: lastVal, lo: Math.round(dataMin), hi: Math.round(dataMax) };
  }, [values, max]);

  const gradId = `g-${label.replace(/[^a-zа-я0-9]/gi, '')}`;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {last === null ? '—' : `${Math.round(last)}${suffix}`}
        </span>
      </div>
      {path ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <path d={area} fill={`url(#${gradId})`} />}
          <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="grid h-11 place-items-center rounded bg-muted/40 text-[10px] text-muted-foreground">
          нет данных
        </div>
      )}
      {path && (
        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{lo}{suffix}</span>
          <span>{hi}{suffix}</span>
        </div>
      )}
    </div>
  );
}
