import { ArrowRight, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';

type Props = {
  delegation: TaskDelegation;
  // Текущий пользователь — определяет, я создатель или делегат (перспектива «от кого / кому»).
  currentUserId: string;
};

// Компактный индикатор делегирования на карточке инбокс-задачи: вместо длинных имён — маленькие
// аватары с раскрытием при наведении (UserAvatarHover). «Кто → кому» — две авы со стрелкой;
// «от кого / кому мне» — одна ава. Направление pending подсвечивается янтарной стрелкой.
// Аватарки без фото рисуются цветными инициалами (у делегации нет avatarUrl) — имя видно в hover.
export function DelegationBadge({ delegation, currentUserId }: Props): React.ReactElement | null {
  if (
    delegation.status !== 'pending' &&
    delegation.status !== 'accepted' &&
    delegation.status !== 'pending_invite'
  ) {
    return null;
  }

  // pending_invite — приглашение в проект + делегирование ждёт вступления делегата.
  if (delegation.status === 'pending_invite') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-violet-700 dark:bg-violet-400/15 dark:text-violet-400">
        <UserAvatarHover
          displayName={delegation.delegateDisplayName}
          avatarUrl={delegation.delegateAvatarUrl}
          subtitle="приглашён(а) в проект — ожидает вступления"
        />
        <UserPlus className="size-2.5 shrink-0" />
        <span className="shrink-0">ожидает</span>
      </span>
    );
  }

  const isCreator = delegation.creatorUserId === currentUserId;
  const isDelegate = delegation.delegateUserId === currentUserId;
  const isPending = delegation.status === 'pending';
  const arrow = (
    <ArrowRight
      className={cn(
        'size-3 shrink-0',
        isPending ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/60',
      )}
    />
  );

  // Наблюдатель (вкладка «Другим», доска общего проекта): показываем обе стороны «кто → кому».
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
          subtitle={isPending ? 'ждёт ответа' : 'выполняет'}
        />
      </span>
    );
  }

  // Я — делегат: «от кого» (кто мне поручил).
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

  // Я — создатель: «кому» (кому я поручил) + статус в подписи раскрытия.
  return (
    <span className="inline-flex items-center gap-1">
      {arrow}
      <UserAvatarHover
        displayName={delegation.delegateDisplayName}
        avatarUrl={delegation.delegateAvatarUrl}
        subtitle={isPending ? 'ждёт ответа' : 'принял(а)'}
      />
    </span>
  );
}
