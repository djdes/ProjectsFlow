import { useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { LiquidIndicator, type IndicatorBox } from '@/lib/liquidIndicator';

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
};

// Ползунок 20px в треке 44×24 с отступом 2px.
const THUMB = 20;
const INSET = 2;
// Под пальцем ползунок тянется в сторону, куда поедет.
const PRESS_STRETCH = 5;

// Лёгкий переключатель без radix-зависимости (стек уже большой). Доступен: role=switch + aria-checked.
// Ползунок — «жидкий» (lib/liquidIndicator): при переключении передний край убегает на жёсткой
// пружине, задний догоняет на мягкой — ползунок вытягивается и стягивается. Без движения
// (reduced motion, «Анимации: выкл») встаёт на место сразу.
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  'aria-label': ariaLabel,
}: SwitchProps): React.ReactElement {
  const trackRef = useRef<HTMLButtonElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<LiquidIndicator | null>(null);

  const boxFor = (on: boolean, stretch = 0): IndicatorBox | null => {
    const track = trackRef.current;
    if (!track) return null;
    const width = THUMB + stretch;
    return {
      left: on ? track.clientWidth - INSET - width : INSET,
      top: (track.clientHeight - THUMB) / 2,
      width,
      height: THUMB,
    };
  };

  useLayoutEffect(() => {
    const thumb = thumbRef.current;
    const box = boxFor(checked);
    if (!thumb || !box) return;
    if (!engineRef.current) {
      engineRef.current = new LiquidIndicator(thumb);
      engineRef.current.jump(box);
      return;
    }
    engineRef.current.springTo(box);
  }, [checked]);

  useEffect(() => () => engineRef.current?.destroy(), []);

  const press = (down: boolean): void => {
    if (disabled) return;
    const box = boxFor(checked, down ? PRESS_STRETCH : 0);
    if (box) engineRef.current?.springTo(box);
  };

  return (
    <button
      ref={trackRef}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      onPointerDown={() => press(true)}
      onPointerUp={() => press(false)}
      onPointerLeave={() => press(false)}
      onPointerCancel={() => press(false)}
      className={cn(
        'pf-switch relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
        // iOS-style: чёткий серый трек в off (в обеих темах), синий в on. Ползунок ВСЕГДА белый
        // (раньше был bg-background → в тёмной теме сливался с фоном и читался как «чёрный кружок»).
        checked ? 'bg-primary' : 'bg-foreground/20',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        ref={thumbRef}
        className="pf-switch-thumb pointer-events-none absolute start-0 top-0 size-5 rounded-full bg-white shadow-md"
      />
    </button>
  );
}
