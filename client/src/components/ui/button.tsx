import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Base-classes:
//   - `transition-all duration-150` + `active:scale-[0.97]` — tactile-feedback при
//     тапе/клике. Subtle (-3%) — заметно но без overkill. Cancels с focus-ring'ом
//     (focus-ring остаётся прозрачным во время press).
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
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-[1.05em] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary CTA: добавили shadow для subtle elevation. Усиливается на hover.
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // mobile 44px (touch) → desktop 40px (mouse). px-5 → px-4 — крупнее
        // padding на мобиле компенсирует «толстый» палец.
        default: 'h-11 px-5 py-2 text-sm sm:h-10 sm:px-4',
        // mobile 40px → desktop 36px. Сохраняем text-xs на desktop, mobile text-sm для читаемости.
        sm: 'h-10 rounded-md px-4 text-sm sm:h-9 sm:px-3 sm:text-xs',
        // mobile 48px → desktop 44px. Самый крупный — для primary-CTA.
        lg: 'h-12 rounded-md px-8 sm:h-11',
        // Квадратные icon-кнопки: `size-10` (40px) desktop → `size-11` (44px) на mobile.
        // ⚠️ Базовый `size-10` + бамп на `max-sm:` (а НЕ `sm:size-10`): иначе call-site
        // override вида `size-6` (без префикса) НЕ перебивал бы `sm:size-10` на десктопе,
        // и ВСЕ переопределённые icon-кнопки сайта раздувались до 40px. Теперь базовый
        // override выигрывает у базового `size-10`, а mobile-бамп живёт на max-sm.
        // `size-X` (а не `h-X w-X`) — чтобы исключиться из mobile-min-h-правила globals.css.
        icon: 'size-10 max-sm:size-11',
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
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
