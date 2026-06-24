import { FileText } from 'lucide-react';
import type { RecentTaskView } from '@/domain/recent/RecentTaskView';

// Презентационное содержимое строки недавней задачи: единый значок документа (как Recents
// в Notion) + описание. Иконку проекта НЕ показываем — недавнее не должно выглядеть как
// список проектов. Минималистично, без названия проекта и времени. Навигацию задаёт родитель.
export function RecentTaskRow({ item }: { item: RecentTaskView }): React.ReactElement {
  return (
    <>
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm leading-snug">
        {item.taskExcerpt || '(без описания)'}
      </span>
    </>
  );
}
