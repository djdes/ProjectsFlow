import * as React from 'react';

import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Минималистичный пустой-state для панели комментариев (Notion-style). Иконка —
// «стопка карточек» + две пунктирные орбиты, нарисована SVG в цветах сайта
// (currentColor через text-*). Лёгкая CSS-анимация (плавное парение карточек +
// пульс орбит) гейтится под useMotion — без сторонних библиотек.

const ANIM_CSS = `
@keyframes pf-cee-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes pf-cee-pulse { 0%,100% { opacity: .35; } 50% { opacity: .7; } }
.pf-cee-card { animation: pf-cee-float 3.2s ease-in-out infinite; }
.pf-cee-card-2 { animation-delay: .35s; }
.pf-cee-card-3 { animation-delay: .7s; }
.pf-cee-orbit { animation: pf-cee-pulse 2.6s ease-in-out infinite; }
.pf-cee-orbit-2 { animation-delay: .8s; }
@media (prefers-reduced-motion: reduce) {
  .pf-cee-card, .pf-cee-orbit { animation: none; }
}
`;

export function CommentsEmptyState({
  label = 'Без комментариев',
  hint,
  className,
}: {
  label?: string;
  hint?: string;
  className?: string;
}): React.ReactElement {
  const { animations } = useMotion();
  const anim = (base: string): string => (animations ? base : '');

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <style>{ANIM_CSS}</style>
      <svg
        width="132"
        height="96"
        viewBox="0 0 132 96"
        fill="none"
        aria-hidden
        className="text-muted-foreground/30"
      >
        {/* Пунктирные орбиты по бокам */}
        <circle
          className={anim('pf-cee-orbit')}
          cx="20"
          cy="44"
          r="8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <circle
          className={anim('pf-cee-orbit pf-cee-orbit-2')}
          cx="112"
          cy="60"
          r="9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        {/* Стопка карточек (каждая: внешняя g — парение, внутренняя — статичный наклон) */}
        <g className={anim('pf-cee-card')} style={{ transformBox: 'view-box' }}>
          <g transform="rotate(-9 66 34)">
            <rect
              x="40"
              y="22"
              width="52"
              height="22"
              rx="6"
              fill="hsl(var(--card))"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </g>
        </g>
        <g className={anim('pf-cee-card pf-cee-card-2')} style={{ transformBox: 'view-box' }}>
          <g transform="rotate(5 66 44)">
            <rect
              x="44"
              y="34"
              width="52"
              height="22"
              rx="6"
              fill="hsl(var(--card))"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </g>
        </g>
        <g className={anim('pf-cee-card pf-cee-card-3')} style={{ transformBox: 'view-box' }}>
          <g transform="rotate(-3 66 56)">
            <rect
              x="38"
              y="48"
              width="56"
              height="22"
              rx="6"
              fill="hsl(var(--card))"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line x1="46" y1="56" x2="74" y2="56" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="46" y1="62" x2="64" y2="62" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        </g>
      </svg>
      <div className="text-sm font-medium text-muted-foreground/70">{label}</div>
      {hint ? <div className="max-w-[16rem] text-xs text-muted-foreground/50">{hint}</div> : null}
    </div>
  );
}
