import { FileText } from 'lucide-react';
import type { RecentTaskView } from '@/domain/recent/RecentTaskView';
import { markdownToPlain } from '@/lib/markdownToPlain';

// Презентационное содержимое строки недавней задачи: единый значок документа (как Recents
// в Notion) + описание. Иконку проекта НЕ показываем — недавнее не должно выглядеть как
// список проектов. Минималистично, без названия проекта и времени. Навигацию задаёт родитель.
// Excerpt прогоняем через markdownToPlain — никаких сырых `**`/`#`/тегов в ленте (задача №9).
export function RecentTaskRow({ item }: { item: RecentTaskView }): React.ReactElement {
  const text = markdownToPlain(item.taskExcerpt);
  return (
    <>
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm leading-snug">{text || '(без описания)'}</span>
    </>
  );
}
