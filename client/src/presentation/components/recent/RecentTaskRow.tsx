import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor } from '@/presentation/layout/projectIcons';
import type { RecentTaskView } from '@/domain/recent/RecentTaskView';

// Иконка проекта в строке «Недавнего»: эмодзи проекта / inbox-иконка / цветной чип с буквой.
function RecentProjectIcon({ item }: { item: RecentTaskView }): React.ReactElement {
  if (item.projectIsInbox) {
    return <Inbox className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  if (item.projectIcon) {
    return (
      <span className="grid size-5 shrink-0 place-items-center text-base leading-none" aria-hidden>
        {item.projectIcon}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold',
        avatarColor(item.projectName),
      )}
      aria-hidden
    >
      {item.projectName.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

// Презентационное содержимое строки недавней задачи: иконка + описание (минималистично,
// без названия проекта и времени). Навигацию задаёт родитель.
export function RecentTaskRow({ item }: { item: RecentTaskView }): React.ReactElement {
  return (
    <>
      <RecentProjectIcon item={item} />
      <span className="min-w-0 flex-1 truncate text-sm leading-snug">
        {item.taskExcerpt || '(без описания)'}
      </span>
    </>
  );
}
