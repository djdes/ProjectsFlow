import { cn } from '@/lib/utils';
import { parseTitleHeading, stripInlineMarkdown } from '@/lib/taskTitleBody';

// Заголовок задачи (первая строка описания) как ПЛОСКИЙ текст — без блочного markdown.
// Зачем: под COMPACT-пресетом первая строка вида `---` (→ <hr>) прячется, а `- x`/`* x`
// (→ список) морфится в буллет — заголовок «исчезает». Рендерим заголовок обычным текстом,
// поэтому он всегда виден буквально. Ведущий `#{1..6} ` (heading) срезаем — иначе на экране
// торчала бы решётка; инлайн-разметку (**…**/`код`/ссылки) разворачиваем в чистый текст.
export function TaskTitleText({
  title,
  className,
}: {
  title: string;
  className?: string;
}): React.ReactElement | null {
  const text = stripInlineMarkdown(parseTitleHeading(title).text).trim();
  if (!text) return null;
  return <p className={cn('text-sm leading-snug', className)}>{text}</p>;
}
