import { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

export type GlassTabItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly badge?: number;
};

type Props = {
  readonly items: readonly GlassTabItem[];
  // Индекс «удерживаемой» вкладки (стеклянный индикатор под ней). -1 — ничего не удержано
  // (моментальные действия: индикатор не переезжает, но иконка «попает» при нажатии).
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
  // Уникальный id инстанса — чтобы стеклянные индикаторы разных баров не «прыгали» друг к другу.
  readonly layoutId: string;
  readonly className?: string;
};

// Переиспользуемый «парящий стеклянный» таб-бар: пружинистый индикатор (layoutId) +
// «поп» иконок при срабатывании. Визуал и пружины — как в нижней мобильной навигации.
// Анимации под useMotion (+ prefers-reduced-motion). Потребители: сайдбар-rail, мобильный nav.
export function GlassTabBar({ items, activeIndex, onSelect, layoutId, className }: Props): React.ReactElement {
  const { animations } = useMotion();
  const [pop, setPop] = useState<{ index: number; id: number }>({ index: -1, id: 0 });

  const select = (i: number): void => {
    onSelect(i);
    setPop((p) => ({ index: i, id: p.id + 1 }));
  };

  const glassTransition = animations
    ? { type: 'spring' as const, stiffness: 520, damping: 34, mass: 0.7 }
    : { duration: 0 };

  return (
    <div
      className={cn(
        'relative flex items-stretch gap-1 rounded-2xl border border-white/15 bg-foreground/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04]',
        className,
      )}
    >
      {items.map((item, idx) => {
        const isHighlighted = idx === activeIndex;
        return (
          <button
            key={item.key}
            type="button"
            aria-label={item.label}
            aria-current={isHighlighted ? 'page' : undefined}
            onClick={() => select(idx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                select(idx);
              }
            }}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] leading-none transition-colors duration-200',
              isHighlighted ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isHighlighted && (
              <motion.span
                aria-hidden
                layoutId={layoutId}
                transition={glassTransition}
                className="absolute inset-0 rounded-xl bg-background/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_1px_3px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.3)] dark:ring-white/10"
              />
            )}
            <span className="relative z-10 inline-flex">
              {animations ? (
                <motion.span
                  key={pop.index === idx ? pop.id : 'idle'}
                  className="inline-flex"
                  initial={pop.index === idx ? { scale: 0.55, rotate: -8 } : false}
                  // Активная иконка «садится» крупнее и чуть приподнята; неактивные мягко
                  // уменьшены и приглушены — движение плавное, а не просто подпрыгивание.
                  animate={{ scale: isHighlighted ? 1.06 : 0.9, y: isHighlighted ? -1 : 0, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 18, mass: 0.7 }}
                >
                  {item.icon}
                </motion.span>
              ) : (
                item.icon
              )}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -right-1.5 -top-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            <span className="relative z-10">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
