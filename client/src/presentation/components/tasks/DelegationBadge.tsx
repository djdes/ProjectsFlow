import { Hourglass, Send, UserCheck, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';

type Props = {
  delegation: TaskDelegation;
  // Текущий пользователь — определяет, я создатель или делегат, чтобы выбрать
  // правильный вариант ярлыка («Делегировано: X» / «От: Y»).
  currentUserId: string;
};

// Ярлык-badge на карточке inbox-задачи. Компакт: иконка + имя; развёрнутая
// формулировка («Делегировано…», «ждёт ответа») — в title-тултипе. Цвет остаётся
// только у семантики: amber = ждёт ответа делегата; входящие/принятые — нейтральные.
// Только активные статусы (pending/accepted) — terminal'ы из этого badge'а не рисуются
// (карточка уже без delegation в этом случае, бэк присылает null).
export function DelegationBadge({ delegation, currentUserId }: Props): React.ReactElement | null {
  if (
    delegation.status !== 'pending' &&
    delegation.status !== 'accepted' &&
    delegation.status !== 'pending_invite'
  ) {
    return null;
  }
  // pending_invite — приглашение в проект + делегирование ждёт ответа. Отдельный
  // фиолетовый бейдж «ожидает вступления» (со стороны наблюдателя/делегатора).
  if (delegation.status === 'pending_invite') {
    return (
      <span
        className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-400/15 dark:text-violet-400"
        title={`${delegation.delegateDisplayName} приглашён(а) в проект — ожидает вступления`}
      >
        <UserPlus className="size-2.5 shrink-0" />
        <span className="min-w-0 truncate">{delegation.delegateDisplayName}</span>
        <span className="shrink-0 opacity-70">· ожидает вступления</span>
      </span>
    );
  }
  const isCreator = delegation.creatorUserId === currentUserId;
  const isDelegate = delegation.delegateUserId === currentUserId;
  const isPending = delegation.status === 'pending';

  // Третье лицо (наблюдатель: вкладка «Другим», доска общего проекта) — показываем обе
  // стороны «кто → кому»; pending — amber («ждёт ответа»), как в перспективе создателя.
  if (!isCreator && !isDelegate) {
    return (
      <span
        className={cn(
          'inline-flex max-w-[200px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
          isPending
            ? 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400'
            : 'bg-muted text-muted-foreground',
        )}
        title={`${delegation.creatorDisplayName} поручил(а): ${delegation.delegateDisplayName}${
          isPending ? ' (ждёт ответа)' : ''
        } · status: ${delegation.status}`}
      >
        <Send className="size-2.5 shrink-0" />
        <span className="min-w-0 truncate">{delegation.creatorDisplayName}</span>
        <span className="shrink-0 opacity-60">→</span>
        <span className="min-w-0 truncate">{delegation.delegateDisplayName}</span>
      </span>
    );
  }

  const name = isCreator ? delegation.delegateDisplayName : delegation.creatorDisplayName;
  const title = isCreator
    ? isPending
      ? `Делегировано: ${name} (ждёт ответа)`
      : `Делегировано: ${name} (принято)`
    : `Делегировал(а): ${name}`;

  const Icon = isCreator ? (isPending ? Hourglass : UserCheck) : Send;

  return (
    <span
      className={cn(
        'inline-flex max-w-[160px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
        isPending && isCreator
          ? 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400'
          : 'bg-muted text-muted-foreground',
      )}
      title={`${title} · status: ${delegation.status}`}
    >
      <Icon className="size-2.5 shrink-0" />
      {!isCreator && <span className="opacity-60">от</span>}
      <span className="truncate">{name}</span>
    </span>
  );
}
