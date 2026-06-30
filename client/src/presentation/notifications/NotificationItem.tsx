import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import type { Notification } from '@/domain/notifications/Notification';
import { getInitials } from '@/presentation/layout/projectIcons';
import type { NotificationActions } from './useNotificationActions';

const roleLabel: Record<'editor' | 'viewer', string> = {
  editor: 'редактор',
  viewer: 'наблюдатель',
};

// Строка уведомления с действиями (принять/отклонить инвайт/делегацию/join-request).
// Переиспользуется на странице /notifications и в ленте «Все»/«Требуется действие».
export function NotificationItem({
  n,
  actions,
}: {
  n: Notification;
  actions: NotificationActions;
}): React.ReactElement {
  const isUnread = n.readAt === null;
  const payload = n.payload;
  const delegationUi = actions.delegationUi[n.id];

  return (
    <li
      onClick={() => actions.handleClick(n)}
      className={cn(
        'group flex cursor-pointer items-start gap-2 px-2.5 py-1.5 transition-colors',
        isUnread ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/40',
      )}
    >
      <span
        className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', isUnread ? 'bg-primary' : 'bg-transparent')}
        aria-hidden
      />
      <Avatar className="size-6 shrink-0">
        <AvatarFallback className="text-[10px]">
          {getInitials(
            payload.type === 'server_alert'
              ? payload.serverName
              : payload.type === 'daily_digest'
                ? payload.projectName
                : payload.type === 'support_ticket'
                  ? (payload.submitterDisplayName ?? 'Поддержка')
                  : payload.actorDisplayName,
          )}
        </AvatarFallback>
      </Avatar>
      {/* Компактные action-кнопки внутри карточки: меньше высота/паддинги/шрифт. */}
      <div className="min-w-0 flex-1 space-y-0.5 [&_button]:h-7 [&_button]:gap-1 [&_button]:px-2.5 [&_button]:text-xs">
        {payload.type === 'comment_mention' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> упомянул тебя в{' '}
              <span className="font-medium">«{payload.projectName}»</span>
              {payload.taskStatus === 'awaiting_clarification' && (
                <>
                  {' '}
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                    title="Задача ждёт твоего ответа"
                  >
                    🤔 ждёт уточнения
                  </span>
                </>
              )}
              {payload.taskExcerpt && (
                <>
                  {' · '}
                  <span className="italic text-muted-foreground">{payload.taskExcerpt}</span>
                </>
              )}
            </p>
            {payload.commentExcerpt && (
              <p className="line-clamp-2 text-xs text-muted-foreground">«{payload.commentExcerpt}»</p>
            )}
          </>
        )}

        {payload.type === 'project_invite' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> приглашает вас в{' '}
              <span className="font-medium">«{payload.projectName}»</span> как {roleLabel[payload.role]}
            </p>
            <div className="pt-1">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.handleAcceptInvite(n);
                }}
              >
                Принять
              </Button>
            </div>
          </>
        )}

        {payload.type === 'task_delegation' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> делегировал вам задачу:
            </p>
            <p className="line-clamp-2 text-xs italic text-muted-foreground">
              «{payload.taskExcerpt || '(без описания)'}»
            </p>
            {delegationUi === 'accepted' ? (
              <p className="pt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Принято</p>
            ) : delegationUi === 'declined' ? (
              <p className="pt-1 text-xs text-muted-foreground">Отклонено</p>
            ) : delegationUi === 'resolved' ? (
              <p className="pt-1 text-xs text-muted-foreground">Уже обработано</p>
            ) : (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={delegationUi === 'busy'}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleAcceptDelegation(n);
                  }}
                >
                  Принять
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={delegationUi === 'busy'}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleDeclineDelegation(n);
                  }}
                >
                  Отклонить
                </Button>
              </div>
            )}
          </>
        )}

        {payload.type === 'task_delegation_resolved' && (
          <p className="text-sm leading-tight">
            <span className="font-medium">{payload.actorDisplayName}</span>{' '}
            {payload.resolution === 'accepted' ? 'принял' : 'отклонил'} делегированную вами задачу
            {payload.taskExcerpt && (
              <>
                {' '}
                <span className="italic text-muted-foreground">«{payload.taskExcerpt}»</span>
              </>
            )}
          </p>
        )}

        {payload.type === 'task_assigned_to_project' && (
          <p className="text-sm leading-tight">
            <span className="font-medium">{payload.actorDisplayName}</span> перенёс делегированную вам задачу в{' '}
            <span className="font-medium">«{payload.projectName}»</span>
            {payload.taskExcerpt && (
              <>
                {' · '}
                <span className="italic text-muted-foreground">«{payload.taskExcerpt}»</span>
              </>
            )}
          </p>
        )}

        {payload.type === 'server_alert' && (
          <p className="text-sm leading-tight">
            {payload.alertStatus === 'resolved' ? '✅ ' : payload.severity === 'critical' ? '🔴 ' : '🟠 '}
            <span className="font-medium">{payload.serverName}</span>
            {' · '}
            {payload.message}
            {' · '}
            <span className="text-muted-foreground">«{payload.projectName}»</span>
          </p>
        )}

        {payload.type === 'daily_digest' && (
          <p className="text-sm leading-tight">
            🗂️ Ежедневная сводка по <span className="font-medium">«{payload.projectName}»</span>
            {' · '}
            {payload.taskCount} задач
          </p>
        )}

        {payload.type === 'support_ticket' && (
          <>
            <p className="text-sm leading-tight">
              🆘 Новое обращение в поддержку
              {payload.submitterDisplayName ? (
                <>
                  {' от '}
                  <span className="font-medium">{payload.submitterDisplayName}</span>
                </>
              ) : (
                ' (аноним)'
              )}
              {payload.source === 'landing' && (
                <span className="text-muted-foreground"> · с лендинга</span>
              )}
            </p>
            {payload.messageExcerpt && (
              <p className="line-clamp-2 text-xs italic text-muted-foreground">
                «{payload.messageExcerpt}»
              </p>
            )}
          </>
        )}

        {payload.type === 'join_request' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.requesterDisplayName ?? 'Пользователь'}</span> просит доступ к
              проекту <span className="font-medium">«{payload.projectName}»</span>
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.handleResolveJoin(n, true);
                }}
              >
                Принять
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.handleResolveJoin(n, false);
                }}
              >
                Отклонить
              </Button>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">{relativeTime(n.createdAt)}</p>
      </div>
    </li>
  );
}
