import * as React from 'react';
import { cn } from '@/lib/utils';
import { useAutoGrowTextarea } from '@/presentation/hooks/useAutoGrowTextarea';

export type AutoGrowTextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'rows'
> & {
  /** Нижняя граница (строк) — поле не схлопывается ниже. По умолчанию 1. */
  minRows?: number;
  /** Потолок авто-роста (строк), дальше внутренний скролл. По умолчанию 12 (site-wide правило). */
  maxRows?: number;
  ref?: React.Ref<HTMLTextAreaElement>;
};

/**
 * Textarea, которая растёт по содержимому до `maxRows` строк (по умолчанию 12),
 * затем скроллится внутри. Единая точка site-wide правила «многострочные поля
 * расширяются до 12 строк». Для полей с меню форматирования (useTextFieldFormatting)
 * подключай хук useAutoGrowTextarea напрямую на существующий <textarea>.
 */
export function AutoGrowTextarea({
  ref,
  value,
  minRows = 1,
  maxRows = 12,
  className,
  ...props
}: AutoGrowTextareaProps): React.ReactElement {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const setRef = React.useCallback(
    (node: HTMLTextAreaElement | null): void => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<HTMLTextAreaElement | null>).current = node;
    },
    [ref],
  );
  useAutoGrowTextarea(innerRef, typeof value === 'string' ? value : String(value ?? ''), {
    minRows,
    maxRows,
  });
  return (
    <textarea
      ref={setRef}
      value={value}
      rows={minRows}
      className={cn(className, 'resize-none')}
      {...props}
    />
  );
}
