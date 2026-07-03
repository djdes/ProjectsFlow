import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectViewsPerDay } from '@/domain/project/ProjectAnalytics';

// График просмотров проекта «как в Notion»: две области (всего — синяя, уникальные —
// янтарная), подписи-дни с чёрточками по оси X, целочисленная ось Y, и чёрный тултип
// при наведении (дата + всего + уникальных) с точкой и пунктирным перекрестием.

const BLUE = 'hsl(var(--primary))';
const AMBER = '#e0a63b';

// «26 июн» — короткая подпись дня под осью.
function fmtTick(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
}
// «29 июня 2026» — заголовок тултипа.
function fmtFull(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
function pluralViews(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'просмотр';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'просмотра';
  return 'просмотров';
}

type Day = { date: Date; count: number; unique: number };

export function ProjectViewsChart({
  perDay,
  windowDays,
}: {
  perDay: readonly ProjectViewsPerDay[];
  windowDays: number;
}): React.ReactElement {
  // «Всё время» приходит большим числом — ограничиваем ленту годом, чтобы график читался.
  const days = Math.max(2, Math.min(windowDays, 365));

  // Плотная посуточная лента (старые → новые), нули для дней без просмотров.
  const series = useMemo<Day[]>(() => {
    const byDate = new Map(perDay.map((p) => [p.date, p]));
    const today = new Date();
    const out: Day[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const p = byDate.get(d.toISOString().slice(0, 10));
      out.push({ date: new Date(d), count: p?.count ?? 0, unique: p?.unique ?? 0 });
    }
    return out;
  }, [perDay, days]);

  // Ширину меряем — рисуем SVG в реальных пикселях (кружки/текст без искажений).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [hi, setHi] = useState<number | null>(null);

  const geom = useMemo(() => {
    const H = 170;
    const L = 26;
    const R = 10;
    const T = 12;
    const B = 24;
    const W = Math.max(220, w);
    const plotW = W - L - R;
    const plotH = H - T - B;
    const n = series.length;
    const maxV = Math.max(1, ...series.map((s) => s.count));
    const yMax = maxV;
    const x = (i: number): number => (n <= 1 ? L + plotW / 2 : L + (i / (n - 1)) * plotW);
    const y = (v: number): number => T + plotH - (v / yMax) * plotH;

    const area = (key: 'count' | 'unique'): string => {
      let d = `M ${x(0).toFixed(1)} ${(T + plotH).toFixed(1)}`;
      series.forEach((s, i) => {
        d += ` L ${x(i).toFixed(1)} ${y(s[key]).toFixed(1)}`;
      });
      d += ` L ${x(n - 1).toFixed(1)} ${(T + plotH).toFixed(1)} Z`;
      return d;
    };
    const line = (key: 'count' | 'unique'): string =>
      series.map((s, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(s[key]).toFixed(1)}`).join(' ');

    // Целочисленные подписи Y (1..max при небольшом max, иначе ~5 «круглых»).
    const yTicks: number[] = [];
    if (yMax <= 6) {
      for (let v = 1; v <= yMax; v += 1) yTicks.push(v);
    } else {
      const step = Math.ceil(yMax / 5);
      for (let v = step; v <= yMax; v += step) yTicks.push(v);
    }

    // ~4 подписи-дня по X, равномерно.
    const tickCount = Math.min(4, n);
    const xTicks: number[] = [];
    for (let k = 0; k < tickCount; k += 1) {
      xTicks.push(Math.round((k / Math.max(1, tickCount - 1)) * (n - 1)));
    }

    return { H, L, R, T, B, W, plotW, plotH, n, yMax, x, y, area, line, yTicks, xTicks };
  }, [series, w]);

  const { H, L, T, W, plotH, x, y, area, line, yTicks, xTicks } = geom;

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - rect.left;
    const i = Math.round(((relX - L) / geom.plotW) * (geom.n - 1));
    setHi(Math.max(0, Math.min(geom.n - 1, i)));
  };

  const hovered = hi !== null ? series[hi] : null;
  const flipLeft = hi !== null && hi > geom.n / 2;

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none"
      style={{ height: H }}
      onMouseMove={onMove}
      onMouseLeave={() => setHi(null)}
    >
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id="pf-views-blue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity="0.22" />
            <stop offset="100%" stopColor={BLUE} stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* Сетка + подписи Y */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={L}
              x2={W - geom.R}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              strokeWidth="1"
              className="text-border"
              opacity="0.5"
            />
            <text
              x={L - 6}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {v}
            </text>
          </g>
        ))}

        {/* Базовая линия оси X */}
        <line x1={L} x2={W - geom.R} y1={T + plotH} y2={T + plotH} stroke="currentColor" strokeWidth="1" className="text-border" />

        {/* Области: всего (синяя) снизу, уникальные (янтарная) поверх нижней части */}
        <path d={area('count')} fill="url(#pf-views-blue)" />
        <path d={area('unique')} fill={AMBER} fillOpacity="0.35" />
        <path d={line('count')} fill="none" stroke={BLUE} strokeWidth="1.75" />
        <path d={line('unique')} fill="none" stroke={AMBER} strokeWidth="1.5" />

        {/* Чёрточки-дни по X */}
        {xTicks.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={T + plotH} y2={T + plotH + 4} stroke="currentColor" strokeWidth="1" className="text-muted-foreground" />
            <text x={x(i)} y={T + plotH + 15} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              {fmtTick(series[i].date)}
            </text>
          </g>
        ))}

        {/* Наведение: пунктирное перекрестие + точка на линии «всего» */}
        {hovered && hi !== null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={T} y2={T + plotH} stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-muted-foreground" opacity="0.7" />
            <line x1={L} x2={x(hi)} y1={y(hovered.count)} y2={y(hovered.count)} stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-muted-foreground" opacity="0.7" />
            <circle cx={x(hi)} cy={y(hovered.count)} r="4" fill={BLUE} stroke="hsl(var(--background))" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Чёрный тултип — дата + всего + уникальных, как в Notion */}
      {hovered && hi !== null && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{
            left: x(hi),
            top: y(hovered.count),
            transform: `translate(${flipLeft ? 'calc(-100% - 10px)' : '10px'}, -50%)`,
          }}
        >
          <div className="mb-0.5 font-medium">{fmtFull(hovered.date)}</div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: BLUE }} />
            {hovered.count} {pluralViews(hovered.count)} всего
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: AMBER }} />
            {hovered.unique} уникальных
          </div>
        </div>
      )}
    </div>
  );
}
