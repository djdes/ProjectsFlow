import { Hourglass, Send, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';

type Props = {
  delegation: TaskDelegation;
  // Текущий пользователь — определяет, я создатель или делегат, чтобы выбрать
  // правильный вариант ярлыка («Делегировано: X» / «От: Y»).
  currentUserId: string;
};

// Ярлык-badge на карточке inbox-задачи. Цвет: amber для pending, blue для accepted.
// Только активные статусы (pending/accepted) — terminal'ы из этого badge'а не рисуются
// (карточка уже без delegation в этом случае, бэк присылает null).
export function DelegationBadge({ delegation, currentUserId }: Props): React.ReactElement | null {
  if (delegation.status !== 'pending' && delegation.status !== 'accepted') {
    return null;
  }
  const isCreator = delegation.creatorUserId === currentUserId;
  const isPending = delegation.status === 'pending';

  const label = isCreator
    ? isPending
      ? `Делегировано: ${delegation.delegateDisplayName} (ждёт ответа)`
      : `Делегировано: ${delegation.delegateDisplayName}`
    : isPending
      ? `От: ${delegation.creatorDisplayName}`
      : `От: ${delegation.creatorDisplayName}`;

  const Icon = isCreator ? Send : UserCheck;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal',
        isPending
          ? 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400'
          : 'bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400',
      )}
      title={`${label} · status: ${delegation.status}`}
    >
      {isPending ? <Hourglass className="size-2.5" /> : <Icon className="size-2.5" />}
      {label}
    </span>
  );
}
