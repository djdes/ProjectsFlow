import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { motionReduced } from '@/lib/liquidIndicator';
import { springEasing } from '@/lib/springEasing';

// Base-classes:
//   - Отклик на нажатие и переходы живут в `.pf-button` (styles/motion.css): сжатие на
//     :active у всех, плавность — только без prefers-reduced-motion, свойства перечислены
//     явно (good-css: никаких `transition: all`).
//   - `[&_svg]:size-[1.05em]` — иконки чуть крупнее, чем `size-4`-фикс. Растут
//     вместе с font-size кнопки (em-based), визуально балансируют padding.
//   - Sizes responsive: на mobile ≥44px (Apple HIG / Material touch-target),
//     на desktop (sm+) — компактнее. icon использует `size-X` (квадрат) чтобы
//     не зацепиться mobile-min-height правилом в globals.css.
const buttonVariants = cva(
  // ⚠️ `[&_svg]:size-[1.05em]` — только ДЕФОЛТ для иконок без явного размера:
  // `.button svg` (0,1,1) специфичнее `.size-3` (0,1,0) и раньше перебивал ЛЮБОЙ
  // явный размер иконки во всех кнопках сайта (иконки выходили ~15px вместо 12px).
  // `:not([class*="size-"])` исключает иконки, у которых размер задан явно.
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-[1.05em] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Дизайн C4: плоские заливки без теней. Главное действие — синяя заливка и
        // полужирный текст; рядом — обводка или «призрак» с мягкой подложкой по наведению.
        default: 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive font-semibold text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-transparent hover:bg-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-active',
        ghost: 'hover:bg-hover',
        link: 'text-primary-ink underline-offset-4 hover:underline',
        // «Принять» / «Готово» — мягкий зелёный того же смысла, что статус «Готово».
        accept: 'bg-done-soft font-semibold text-done-ink hover:bg-done-soft-hover',
      },
      size: {
        // Плотная шкала C4: на десктопе 32px (как кнопки Notion), на мобиле 44px (touch).
        default: 'h-11 px-4 py-2 text-sm sm:h-8 sm:px-3',
        // mobile 40px → desktop 28px.
        sm: 'h-10 rounded-lg px-3 text-sm sm:h-7 sm:px-2.5 sm:text-xs',
        // mobile 48px → desktop 36px. Самый крупный — для главного действия формы.
        lg: 'h-12 rounded-lg px-6 sm:h-9 sm:px-4',
        // Квадратные icon-кнопки: `size-8` (32px) desktop → `size-11` (44px) на mobile.
        // ⚠️ Базовый `size-8` + бамп на `max-sm:` (а НЕ `sm:size-8`): иначе call-site
        // override вида `size-6` (без префикса) НЕ перебивал бы `sm:size-8` на десктопе.
        // `size-X` (а не `h-X w-X`) — чтобы исключиться из mobile-min-h-правила globals.css.
        icon: 'size-8 max-sm:size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Идёт действие: перед подписью крутилка, кнопка помечена aria-busy. */
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

// Подпись кнопки как строка: смена подписи («Войти» → «Входим…») — это смена состояния кнопки.
function labelOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(labelOf).join('');
  if (React.isValidElement(node)) return labelOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

/**
 * Кнопка — одна фигура, которая меняет состояние (как в ролике движения): новая подпись
 * проявляется из короткого размытия (.pf-button-label[data-pf-swap], styles/motion.css), а
 * ширина перетекает от прежней к новой на пружине, если подпись стала длиннее или короче.
 * Ширина до смены запоминается при монтировании, после каждой смены и в момент нажатия
 * (подпись обычно меняется от нажатия: «Сохранить» → «Сохраняем…»).
 */
function useLabelMorph(el: React.RefObject<HTMLButtonElement | null>, label: string): { swapped: boolean; remember: () => void } {
  const width = React.useRef<number | null>(null);
  const shown = React.useRef(label);
  const [swapped, setSwapped] = React.useState(false);
  React.useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    if (shown.current === label) {
      width.current ??= node.offsetWidth;
      return;
    }
    shown.current = label;
    setSwapped(true);
    const before = width.current;
    const after = node.offsetWidth;
    width.current = after;
    if (before == null || Math.abs(after - before) < 1.5 || motionReduced() || typeof node.animate !== 'function') return;
    node.style.overflow = 'hidden';
    const run = node.animate([{ width: `${before}px` }, { width: `${after}px` }], { duration: 440, easing: springEasing() });
    const done = (): void => {
      node.style.overflow = '';
    };
    run.onfinish = done;
    run.oncancel = done;
  }, [el, label]);
  const remember = (): void => {
    if (el.current) width.current = el.current.offsetWidth;
  };
  return { swapped, remember };
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  onClick,
  loading = false,
  children,
  ref,
  ...props
}: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot : 'button';
  const own = React.useRef<HTMLButtonElement | null>(null);
  const label = `${labelOf(children)}${loading ? '\u0001' : ''}`;
  const { swapped, remember } = useLabelMorph(own, label);
  // «Принять» / «Готово» подтверждаются короткой вибрацией на телефоне (lib/haptics).
  const handleClick: typeof onClick =
    variant === 'accept'
      ? (event) => {
          haptic('success');
          onClick?.(event);
        }
      : onClick;
  if (asChild) {
    return (
      <Comp ref={ref} className={cn('pf-button', buttonVariants({ variant, size, className }))} onClick={handleClick} {...props}>
        {children}
      </Comp>
    );
  }
  return (
    <button
      ref={(node) => {
        own.current = node;
        assignRef(ref, node);
      }}
      className={cn('pf-button', buttonVariants({ variant, size, className }))}
      onClick={handleClick}
      {...props}
      aria-busy={loading || props['aria-busy'] || undefined}
      onPointerDown={(event) => {
        // Ширина прямо перед нажатием — от неё перетечёт подпись, сменённая этим нажатием.
        remember();
        props.onPointerDown?.(event);
      }}
    >
      <span key={label} className="pf-button-label" data-pf-swap={swapped ? '' : undefined}>
        {loading && <Loader2 aria-hidden className="pf-button-spinner motion-safe:animate-spin" />}
        {children}
      </span>
    </button>
  );
}

export { buttonVariants };
