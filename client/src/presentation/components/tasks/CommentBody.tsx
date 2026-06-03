import { Markdown } from '@/presentation/components/markdown/Markdown';

// Тело комментария — тонкая обёртка над общим <Markdown> (GFM + перенос строк +
// санитизация). Отдельное имя сохраняем: комментарии — пользовательский ввод, и
// семантика «тело комментария» читается на местах вызова лучше, чем голый Markdown.
// className проксируется (LiveTab передаёт RICH_MD для «крупного» вида ассистента).
export function CommentBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}): React.ReactElement {
  return <Markdown className={className}>{body}</Markdown>;
}
