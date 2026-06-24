import { cloneElement, isValidElement } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

export type RailItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly badge?: number;
};

// Навигационный рейл в стиле Notion: активная кнопка — широкая, с иконкой + текстом; три
// остальные — узкие, только иконки. Переключение плавно «перетекает» (motion layout):
// активная расширяется и проявляет подпись, прочие сжимаются. Подложка активной едет между
// кнопками через layoutId. Любая из 4 может быть активной.
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
  const spring = animations
    ? { type: 'spring' as const, stiffness: 460, damping: 34, mass: 0.7 }
    : { duration: 0 };

  return (
    <div className="flex items-stretch gap-1">
      {items.map((item, idx) => {
        const active = idx === activeIndex;
        const icon = isValidElement(item.icon)
          ? cloneElement(item.icon as React.ReactElement<{ active?: boolean }>, { active })
          : item.icon;
        return (
          <motion.button
            layout
            key={item.key}
            type="button"
            onClick={() => onSelect(idx)}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            transition={spring}
            className={cn(
              'relative flex min-w-0 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition-colors',
              active
                ? 'flex-1 text-foreground'
                : 'px-2.5 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]',
            )}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId="pf-rail-active"
                transition={spring}
                className="absolute inset-0 rounded-xl bg-foreground/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] ring-1 ring-black/[0.04] dark:bg-white/10 dark:ring-white/10"
              />
            )}
            <span className="relative z-10 inline-flex shrink-0">{icon}</span>
            <AnimatePresence initial={false}>
              {active && (
                <motion.span
                  key="label"
                  initial={animations ? { opacity: 0, width: 0 } : false}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={animations ? { opacity: 0, width: 0 } : undefined}
                  transition={spring}
                  className="relative z-10 overflow-hidden whitespace-nowrap"
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="absolute right-1 top-0.5 z-10 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
