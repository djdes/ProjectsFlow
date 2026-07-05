import { cloneElement, isValidElement, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Тип кнопки рейла:
// - 'tab' — вкладка-переключатель (Главная / Чат): активная слегка подсвечена и остаётся
//   «нажатой». Клик выбирает вкладку.
// - 'action' — простая кнопка действия (Задача / Входящие / Поиск): без persistent-active,
//   клик выполняет onAction.
// Все кнопки — единый ряд, иконка + подпись СНИЗУ, подпись всегда видна (YouTube-style).
export type RailItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly badge?: number;
  readonly variant?: 'tab' | 'action';
  // Только для variant: 'action' — обработчик клика-действия.
  readonly onAction?: () => void;
  // Акцентная центральная кнопка («Задача»): иконка в залитом кружке, выделяется в ряду.
  readonly accent?: boolean;
};

// Навигационный рейл: один ровный ряд, у каждого элемента иконка сверху и подпись снизу
// (всегда видима, не раскрывается). Активная вкладка (Главная/Чат) слегка подсвечена;
// центральная «Задача» — акцентная. Иконки (AnimatedXxx) оживают на hover/active.
export function SidebarNavRail({
  items,
  activeIndex,
  onSelect,
  compact = false,
}: {
  readonly items: readonly RailItem[];
  readonly activeIndex: number;
  // Вызывается при клике по вкладке (variant: 'tab'); index — позиция в исходном массиве.
  readonly onSelect: (index: number) => void;
  // Узкая панель: скрываем подписи — остаются только иконки (кнопки становятся иконками).
  readonly compact?: boolean;
}): React.ReactElement {
  const { animations } = useMotion();
  const [hovered, setHovered] = useState<number | null>(null);

  const renderIcon = (item: RailItem, idx: number, forceActive: boolean): React.ReactNode => {
    const live = forceActive || idx === hovered;
    return isValidElement(item.icon)
      ? cloneElement(item.icon as React.ReactElement<{ active?: boolean }>, { active: live })
      : item.icon;
  };

  const badge = (item: RailItem): React.ReactNode =>
    item.badge !== undefined && item.badge > 0 ? (
      <span className="absolute -right-2 -top-1.5 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
        {item.badge > 99 ? '99+' : item.badge}
      </span>
    ) : null;

  return (
    <div className="flex items-stretch justify-between gap-0.5">
      {items.map((item, idx) => {
        const isTab = item.variant !== 'action';
        const active = isTab && idx === activeIndex;
        const accent = Boolean(item.accent);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => (isTab ? onSelect(idx) : item.onAction?.())}
            onMouseEnter={() => setHovered(idx)}
            onMouseLeave={() => setHovered((h) => (h === idx ? null : h))}
            onFocus={() => setHovered(idx)}
            onBlur={() => setHovered((h) => (h === idx ? null : h))}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group/nav relative flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-medium leading-none',
              animations && 'transition-colors duration-200 ease-out',
              // Акцентная «Задача» — без подписи, кружок центрируется по высоте ряда.
              accent && 'justify-center',
              active
                ? 'bg-foreground/[0.06] text-foreground ring-1 ring-black/[0.04] dark:bg-white/10 dark:ring-white/10'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]',
            )}
          >
            {/* Единый по высоте бокс иконки (подписи в один ряд). Акцентная «Задача» —
                крупный залитый primary-кружок с белой иконкой (как «+» в YouTube), без подписи. */}
            <span
              className={cn(
                'relative grid size-7 place-items-center rounded-full',
                accent && 'size-9 bg-primary text-primary-foreground shadow-sm',
                accent &&
                  animations &&
                  'transition-transform duration-200 group-hover/nav:scale-105 group-active/nav:scale-95',
              )}
            >
              {renderIcon(item, idx, active)}
              {badge(item)}
            </span>
            {!accent && !compact && <span className="max-w-full truncate">{item.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
