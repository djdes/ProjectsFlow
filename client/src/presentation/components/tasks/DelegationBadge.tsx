import { ArrowRight } from 'lucide-react';
import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';

type Props = {
  delegation: TaskDelegation;
  // Текущий пользователь — определяет перспективу «от кого / кому».
  currentUserId: string;
};

// Компактный индикатор делегирования на карточке задачи. Делегация создаётся сразу
// принятой (accepted) — состояний «ждёт ответа»/«ожидает вступления» больше нет.
// «Кто → кому» — две авы со стрелкой; «от кого / кому мне» — одна ава.
export function DelegationBadge({ delegation, currentUserId }: Props): React.ReactElement | null {
  if (delegation.status !== 'accepted') return null;

  const isCreator = delegation.creatorUserId === currentUserId;
  const isDelegate = delegation.delegateUserId === currentUserId;
  const arrow = <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />;

  // Наблюдатель: обе стороны «кто → кому».
  if (!isCreator && !isDelegate) {
    return (
      <span className="inline-flex items-center gap-1">
        <UserAvatarHover
          displayName={delegation.creatorDisplayName}
          avatarUrl={delegation.creatorAvatarUrl}
          subtitle="поручил(а)"
        />
        {arrow}
        <UserAvatarHover
          displayName={delegation.delegateDisplayName}
          avatarUrl={delegation.delegateAvatarUrl}
          subtitle="выполняет"
        />
      </span>
    );
  }

  // Я — делегат: «от кого».
  if (isDelegate) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="opacity-70">от</span>
        <UserAvatarHover
          displayName={delegation.creatorDisplayName}
          avatarUrl={delegation.creatorAvatarUrl}
          subtitle="поручил(а) вам"
        />
      </span>
    );
  }

  // Я — создатель: «кому».
  return (
    <span className="inline-flex items-center gap-1">
      {arrow}
      <UserAvatarHover
        displayName={delegation.delegateDisplayName}
        avatarUrl={delegation.delegateAvatarUrl}
        subtitle="выполняет"
      />
    </span>
  );
}
