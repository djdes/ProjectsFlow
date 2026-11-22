import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { useLiquidIndicator } from '@/presentation/components/motion/useLiquidIndicator';

export type SegmentOption<T extends string> = {
  readonly value: T;
  readonly label?: string;
  readonly icon?: React.ReactNode;
  readonly ariaLabel?: string;
};

// Сегментированный переключатель: выбранная пилюля перетекает к новому сегменту на двух
// пружинах — передний край убегает, задний догоняет (lib/liquidIndicator).
// Вид C4: серая подложка, выбранный сегмент — белая плашка с лёгкой тенью (в тёмной теме —
// приподнятая графитовая). Единая высота сегментов (h-7 desktop, ≥40px touch на мобайле).
// Без движения при reduced-motion и «Анимации: выкл» — пилюля встаёт на место сразу.
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
  const rail = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useLiquidIndicator({ containerRef: rail, indicatorRef: pill, activeSelector: '[aria-selected="true"]', activeKey: value });
  const seg = size === 'sm' ? 'h-6 px-2 max-sm:h-9' : 'h-7 px-2.5 max-sm:h-10';

  return (
    <div
      ref={rail}
      role="tablist"
      className={cn(
        'relative isolate inline-flex items-center gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5 text-ui dark:bg-panel',
        className,
      )}
    >
      <span
        ref={pill}
        aria-hidden
        className="pointer-events-none absolute start-0 top-0 rounded-md bg-background opacity-0 shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none"
      />
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
