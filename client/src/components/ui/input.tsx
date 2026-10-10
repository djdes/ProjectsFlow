import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type, ...props }: InputProps): React.ReactElement {
  return (
    <input
      type={type}
      className={cn(
        // C4: плотное поле 36px, белое на светлом листе и графитовое в тёмной теме. Фокус —
        // синяя рамка: она видна и при клике мышью (кольца для указателя глушит globals.css),
        // мягкое кольцо добавляется с клавиатуры. Без sm:-вариантов в базе: их не перебить
        // размером/отступом из className (поле с иконкой ставит ps-7 и т.п.).
        'flex h-9 w-full rounded-md border border-input bg-field px-3 py-1.5 text-sm ring-offset-background transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 focus-visible:border-primary/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
