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
// Единая высота сегментов (h-8 desktop, ≥40px touch на мобайле) — чтобы кнопки были ровными.
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
  const seg = size === 'sm' ? 'h-7 px-2.5 max-sm:h-9' : 'h-8 px-3 max-sm:h-10';

  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border bg-card p-0.5 text-xs',
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
              'relative inline-flex items-center justify-center gap-1.5 rounded-md font-medium',
              'transition-colors duration-150 active:scale-[0.96]',
              seg,
              active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={animations ? `seg-${layoutId}` : undefined}
                className="absolute inset-0 rounded-md bg-primary shadow-sm"
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
