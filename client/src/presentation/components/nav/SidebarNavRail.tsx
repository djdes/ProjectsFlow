import { cloneElement, isValidElement, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

export type RailItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly badge?: number;
};

// Навигационный рейл в стиле Notion: активная кнопка — широкая (иконка + текст), три
// остальные — узкие, только иконки. Морф — на ЧИСТОМ CSS (кроссфейд фона + max-width у
// подписи), без motion-layout/layoutId. Это важно для плавности: motion-layout заставлял бы
// браузер мерить layout каждый кадр (forced reflow) и анимировать `width` через JS — отсюда
// подлагивание. CSS-переходы идут по оптимизированному пути и «летают». Иконки внутри
// (AnimatedXxx) сохраняют свои микро-анимации через прокинутый active.
export function SidebarNavRail({
  items,
  activeIndex,
  onSelect,
}: {
  readonly items: readonly RailItem[];
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
}): React.ReactElement {
  const { animations } = useMotion();
  // Иконка «оживает» не только когда вкладка активна, но и при наведении — так весь рейл
  // ощущается живым. Подсветка/морф кнопки при этом завязаны только на active (не на hover).
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex items-center gap-1">
      {items.map((item, idx) => {
        const active = idx === activeIndex;
        const live = active || idx === hovered;
        const icon = isValidElement(item.icon)
          ? cloneElement(item.icon as React.ReactElement<{ active?: boolean }>, { active: live })
          : item.icon;
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
              {icon}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -right-1.5 -top-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            {/* Подпись активной кнопки: разворачивается через max-width (CSS, без JS-анимации). */}
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
