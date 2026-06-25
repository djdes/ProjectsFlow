import { cloneElement, isValidElement, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Тип кнопки рейла:
// - 'tab' — вкладка-переключатель (Notion-style): активная разворачивается с подписью,
//   остаётся «нажатой». Клик выбирает вкладку (Главная / Чат).
// - 'action' — простая icon-кнопка действия (Входящие / Поиск): только иконка, без
//   persistent-active. Клик выполняет действие и НЕ оставляет кнопку «нажатой».
export type RailItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly badge?: number;
  readonly variant?: 'tab' | 'action';
  // Только для variant: 'action' — обработчик клика-действия.
  readonly onAction?: () => void;
};

// Навигационный рейл в стиле Notion: слева вкладки-переключатели (активная — широкая,
// иконка + текст), справа (прижаты к правому краю) — icon-кнопки действий без активного
// состояния. Морф вкладок — на ЧИСТОМ CSS (кроссфейд фона + max-width у подписи), без
// motion-layout/layoutId: это держит плавность (CSS-переходы идут по оптимизированному
// пути, без forced reflow на каждый кадр). Иконки внутри (AnimatedXxx) сохраняют свои
// микро-анимации через прокинутый active.
export function SidebarNavRail({
  items,
  activeIndex,
  onSelect,
}: {
  readonly items: readonly RailItem[];
  readonly activeIndex: number;
  // Вызывается при клике по вкладке (variant: 'tab'); index — позиция в исходном массиве.
  readonly onSelect: (index: number) => void;
}): React.ReactElement {
  const { animations } = useMotion();
  // Иконка «оживает» не только когда вкладка активна, но и при наведении — так весь рейл
  // ощущается живым. Подсветка/морф кнопки при этом завязаны только на active (не на hover).
  const [hovered, setHovered] = useState<number | null>(null);

  const renderIcon = (item: RailItem, idx: number, forceActive: boolean): React.ReactNode => {
    const live = forceActive || idx === hovered;
    return isValidElement(item.icon)
      ? cloneElement(item.icon as React.ReactElement<{ active?: boolean }>, { active: live })
      : item.icon;
  };

  const badge = (item: RailItem): React.ReactNode =>
    item.badge !== undefined && item.badge > 0 ? (
      <span className="absolute -right-1.5 -top-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
        {item.badge > 99 ? '99+' : item.badge}
      </span>
    ) : null;

  return (
    <div className="flex items-center gap-1">
      {items.map((item, idx) => {
        if (item.variant === 'action') {
          // Простая icon-кнопка действия: только иконка, без persistent-active. Первая
          // action-кнопка прижимает группу действий к правому краю (ml-auto).
          const firstAction = items.findIndex((it) => it.variant === 'action') === idx;
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onAction}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered((h) => (h === idx ? null : h))}
              aria-label={item.label}
              title={item.label}
              className={cn(
                'relative grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground',
                animations && 'transition-colors duration-200 ease-out',
                firstAction && 'ml-auto',
              )}
            >
              <span className="relative inline-flex shrink-0">
                {renderIcon(item, idx, false)}
                {badge(item)}
              </span>
            </button>
          );
        }

        // variant 'tab' (по умолчанию): вкладка-переключатель.
        const active = idx === activeIndex;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(idx)}
            onMouseEnter={() => setHovered(idx)}
            onMouseLeave={() => setHovered((h) => (h === idx ? null : h))}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center rounded-xl px-2 py-2 text-xs font-medium',
              animations && 'transition-colors duration-200 ease-out',
              active
                ? 'bg-foreground/[0.06] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] ring-1 ring-black/[0.04] dark:bg-white/10 dark:ring-white/10'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]',
            )}
          >
            <span className="relative inline-flex shrink-0">
              {renderIcon(item, idx, active)}
              {badge(item)}
            </span>
            {/* Подпись активной вкладки: разворачивается через max-width (CSS, без JS-анимации). */}
            <span
              className={cn(
                'overflow-hidden whitespace-nowrap',
                animations && 'transition-all duration-200 ease-out',
                active ? 'ml-1.5 max-w-[120px] opacity-100' : 'ml-0 max-w-0 opacity-0',
              )}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
