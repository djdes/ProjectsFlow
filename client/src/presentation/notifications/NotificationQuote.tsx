import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { toneClass, toneOf } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { SANITIZE_SCHEMA, applyInlineMarkSyntax } from '@/presentation/components/markdown/markdownSchema';

export function NotificationQuote({ author, text }: { author: string; text?: string }): React.ReactElement {
  const preview = text && (text.length > 1200 ? `${text.slice(0, 1200).trimEnd()}…` : text);
  return (
    <div className={cn('notification-quote mbs-2 min-w-0 rounded-md border-s-[3px] px-3 py-2', toneClass(toneOf(author)))}>
      <div className="notification-quote-author truncate text-xs font-semibold" title={author}>{author}</div>
      {preview && (
        <div className="mbs-1 line-clamp-5 break-words text-sm font-normal leading-5 text-foreground [overflow-wrap:anywhere] [&_p+p]:mbs-1 [&_ul]:list-disc [&_ul]:ps-4 [&_ol]:list-decimal [&_ol]:ps-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_pre]:whitespace-pre-wrap">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
            allowedElements={['p', 'strong', 'em', 'b', 'i', 'u', 'mark', 's', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'br', 'a', 'img']}
            unwrapDisallowed
            components={{
              a: ({ children }) => <span>{children}</span>,
              img: ({ alt }) => <span>[{alt || 'изображение'}]</span>,
              input: () => null,
            }}
          >{applyInlineMarkSyntax(preview)}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
