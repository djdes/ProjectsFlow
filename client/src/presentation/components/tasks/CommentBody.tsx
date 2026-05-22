import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/utils';

// Рендер тела комментария: markdown (GFM) + безопасный html. rehype-raw парсит сырой
// html, rehype-sanitize вырезает XSS (script/on*-атрибуты/javascript: и т.п.) — комментарии
// это пользовательский ввод в мульти-юзер-проектах, поэтому санитизация обязательна.
// Порядок плагинов важен: raw → sanitize.
export function CommentBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none break-words',
        // компактнее дефолтного prose: убираем большие отступы у первого/последнего блока
        'prose-p:my-1 prose-pre:my-2 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
