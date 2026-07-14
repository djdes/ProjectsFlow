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

// Строка уведомления с действиями (принять инвайт в пространство/проект, join-request;
// старые уведомления о назначении — информационные). Переиспользуется на странице
// /notifications и в ленте «Все»/«Требуется действие».
export function NotificationItem({
  n,
  actions,
}: {
  n: Notification;
  actions: NotificationActions;
}): React.ReactElement {
  const isUnread = n.readAt === null;
  const payload = n.payload;
  const actionUi = actions.actionUi[n.id];

  return (
    <li
      onClick={() => actions.handleClick(n)}
      className={cn(
        // overflow-hidden = содержит float аватара; текст обтекает иконку (справа от неё и
        // продолжается под ней на всю ширину блока) — так шире и читабельнее.
        'group cursor-pointer overflow-hidden px-3 py-2 transition-colors',
        isUnread ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/40',
      )}
    >
      <span className="relative float-left mr-2.5">
        <Avatar className="size-7 ring-1 ring-border">
          <AvatarFallback className="text-[11px]">
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
        {/* Непрочитанное — точка на углу аватара (выделяет иконку). */}
        {isUnread && (
          <span
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background"
            aria-hidden
          />
        )}
      </span>
      {/* Компактные action-кнопки внутри карточки: меньше высота/паддинги/шрифт. */}
      <div className="space-y-0.5 [&_button]:h-7 [&_button]:gap-1 [&_button]:px-2.5 [&_button]:text-xs">
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
            {actionUi === 'accepted' ? (
              <p className="clear-left pt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Принято
              </p>
            ) : actionUi === 'resolved' ? (
              <p className="clear-left pt-1 text-xs text-muted-foreground">Уже обработано</p>
            ) : (
              <div className="clear-left pt-1">
                <Button
                  size="sm"
                  disabled={actionUi === 'busy'}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleAcceptInvite(n);
                  }}
                >
                  Принять
                </Button>
              </div>
            )}
          </>
        )}

        {payload.type === 'workspace_invite' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> приглашает вас в
              пространство <span className="font-medium">«{payload.workspaceName}»</span> как{' '}
              {roleLabel[payload.role]}
            </p>
            {actionUi === 'accepted' ? (
              <p className="clear-left pt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Принято
              </p>
            ) : actionUi === 'resolved' ? (
              <p className="clear-left pt-1 text-xs text-muted-foreground">Уже обработано</p>
            ) : (
              <div className="clear-left pt-1">
                <Button
                  size="sm"
                  disabled={actionUi === 'busy'}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleAcceptWorkspaceInvite(n);
                  }}
                >
                  Принять
                </Button>
              </div>
            )}
          </>
        )}

        {payload.type === 'task_delegation' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> назначил(а) вас
              ответственным за задачу:
            </p>
            <p className="line-clamp-2 text-xs italic text-muted-foreground">
              «{payload.taskExcerpt || '(без описания)'}»
            </p>
          </>
        )}

        {payload.type === 'task_assignee_changed' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> назначил(а) вас
              ответственным за задачу:
            </p>
            <p className="line-clamp-2 text-xs italic text-muted-foreground">
              «{payload.taskExcerpt || '(без описания)'}»
            </p>
          </>
        )}

        {payload.type === 'task_delegation_resolved' && payload.resolution === 'declined' && (
          <p className="text-sm leading-tight">
            <span className="font-medium">{payload.actorDisplayName}</span> снял(а) с себя задачу
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
            <span className="font-medium">{payload.actorDisplayName}</span> перенёс задачу, за которую вы
            отвечаете, в{' '}
            <span className="font-medium">«{payload.projectName}»</span>
            {payload.taskExcerpt && (
              <>
                {' · '}
                <span className="italic text-muted-foreground">«{payload.taskExcerpt}»</span>
              </>
            )}
          </p>
        )}

        {payload.type === 'chat_mention' && (
          <>
            <p className="text-sm leading-tight">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> упомянул(а) вас в
              чате <span className="font-medium">«{payload.workspaceName}»</span>
            </p>
            {payload.messageExcerpt && (
              <p className="line-clamp-2 text-xs text-muted-foreground">«{payload.messageExcerpt}»</p>
            )}
          </>
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
            {actionUi === 'accepted' ? (
              <p className="clear-left pt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Доступ предоставлен
              </p>
            ) : actionUi === 'declined' ? (
              <p className="clear-left pt-1 text-xs text-muted-foreground">Запрос отклонён</p>
            ) : (
              <div className="flex clear-left gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={actionUi === 'busy'}
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
                  disabled={actionUi === 'busy'}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleResolveJoin(n, false);
                  }}
                >
                  Отклонить
                </Button>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground">{relativeTime(n.createdAt)}</p>
      </div>
    </li>
  );
}
