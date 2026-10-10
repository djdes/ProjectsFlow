import { useId } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

export type SegmentOption<T extends string> = {
  readonly value: T;
  readonly label?: string;
  readonly icon?: React.ReactNode;
  readonly ariaLabel?: string;
};

// Сегментированный переключатель с плавно «переезжающей» активной пилюлей (spring, как rail).
// Вид C4: серая подложка, выбранный сегмент — белая плашка с лёгкой тенью (в тёмной теме —
// приподнятая графитовая). Единая высота сегментов (h-7 desktop, ≥40px touch на мобайле).
// Анимация гейтится useMotion (+ pf-no-motion / reduced-motion → мгновенно).
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}): React.ReactElement {
  const { animations } = useMotion();
  const layoutId = useId();
  const seg = size === 'sm' ? 'h-6 px-2 max-sm:h-9' : 'h-7 px-2.5 max-sm:h-10';

  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5 text-ui dark:border dark:border-border dark:bg-panel',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.ariaLabel ?? opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative inline-flex items-center justify-center gap-1.5 rounded-md',
              'transition-colors duration-150 active:scale-[0.96]',
              seg,
              active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={animations ? `seg-${layoutId}` : undefined}
                className="absolute inset-0 rounded-md bg-background shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none"
                transition={
                  animations ? { type: 'spring', stiffness: 460, damping: 34 } : { duration: 0 }
                }
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
