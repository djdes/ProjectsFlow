import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

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
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-[1.05em] [&_svg]:shrink-0',
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
        sm: 'h-10 rounded-md px-3 text-sm sm:h-7 sm:px-2.5 sm:text-xs',
        // mobile 48px → desktop 36px. Самый крупный — для главного действия формы.
        lg: 'h-12 rounded-md px-6 sm:h-9 sm:px-4',
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
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn('pf-button', buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
