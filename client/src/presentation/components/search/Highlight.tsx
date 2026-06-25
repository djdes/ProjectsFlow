import { Fragment } from 'react';
import { cn } from '@/lib/utils';

// Подсветка вхождений query в тексте (регистронезависимо, ru-locale). Совпадения оборачиваются
// в <mark> с мягким фоном — для результатов поиска (имя проекта, отрывок задачи). Пустой
// query или отсутствие совпадения → текст как есть.
export function Highlight({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}): React.ReactElement {
  const q = query.trim();
  if (q.length === 0) return <>{text}</>;
  const lower = text.toLocaleLowerCase('ru');
  const needle = q.toLocaleLowerCase('ru');
  let from = lower.indexOf(needle);
  if (from < 0) return <>{text}</>;

  // Ключи по позиции в строке — стабильны и уникальны, без отдельного счётчика.
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (from >= 0) {
    if (from > cursor) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, from)}</Fragment>);
    parts.push(
      <mark key={`m${from}`} className={cn('rounded-[3px] bg-primary/20 px-px text-foreground', className)}>
        {text.slice(from, from + q.length)}
      </mark>,
    );
    cursor = from + q.length;
    from = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
