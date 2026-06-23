import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor } from '@/presentation/layout/projectIcons';
import { relativeTime } from '@/lib/relativeTime';
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

// Презентационное содержимое строки недавней задачи (иконка + описание + проект·время).
// Навигацию задаёт родитель (NavLink в блоке / button c onClick в диалоге).
export function RecentTaskRow({ item }: { item: RecentTaskView }): React.ReactElement {
  return (
    <>
      <RecentProjectIcon item={item} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-snug">
          {item.taskExcerpt || '(без описания)'}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {item.projectIsInbox ? 'Входящие' : item.projectName} · {relativeTime(item.viewedAt)}
        </span>
      </span>
    </>
  );
}
