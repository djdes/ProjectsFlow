import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/utils';

// Общий рендер markdown (GFM + перенос строк + безопасный html). Используется для
// пользовательского ввода в мульти-юзер-проектах (описания задач, комментарии,
// текст ассистента), поэтому санитизация обязательна: rehype-raw парсит сырой html,
// rehype-sanitize вырезает XSS (script / on*-атрибуты / javascript:). Порядок плагинов
// важен: raw → sanitize. remark-breaks превращает одиночный перенос строки в <br>,
// чтобы сохранить разметку как её набрал автор (поведение прежнего whitespace-pre-wrap).
//
// Защита от «разъезжания» вёрстки: контент НЕ должен расширять родителя по горизонтали —
// длинные слова/ссылки переносятся (overflow-wrap), а блоки кода и таблицы скроллятся
// внутри своего бокса (overflow-x-auto), а не толкают layout наружу. min-w-0 позволяет
// компоненту ужиматься, когда он живёт во flex/grid-родителе.
const BASE_PROSE = cn(
  'prose prose-sm dark:prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere]',
  // компактнее дефолтного prose: меньше отступы у блоков
  'prose-p:my-1 prose-pre:my-2 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1',
  // overflow-guard: код/таблицы скроллятся внутри себя, картинки не вылезают за ширину
  'prose-pre:max-w-full prose-pre:overflow-x-auto prose-img:max-w-full prose-img:h-auto',
  '[&_table]:block [&_table]:w-fit [&_table]:max-w-full [&_table]:overflow-x-auto',
);

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn(BASE_PROSE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Пресет для «карточного» рендера (kanban-карточка, строки списка, inbox). Текст
// прижат (нулевые отступы блоков), заголовки не «раздуваются» (выглядят как жирный
// текст body-размера), картинки скрыты (на превью не нужны — есть бейдж вложений),
// ссылки некликабельны (клик по карточке открывает задачу — ссылку откроют внутри).
// Сам line-clamp-N задаёт вызывающая сторона (на карточке 3 строки, в списке — 2).
export const MARKDOWN_COMPACT = cn(
  'text-sm leading-snug',
  '[&_p]:my-0 [&_ul]:my-0 [&_ol]:my-0 [&_li]:my-0 [&_blockquote]:my-0 [&_pre]:my-1 [&_hr]:my-1',
  '[&_h1]:my-0 [&_h2]:my-0 [&_h3]:my-0 [&_h4]:my-0',
  '[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm',
  '[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold',
  '[&_pre]:text-xs [&_img]:hidden [&_a]:pointer-events-none',
);
