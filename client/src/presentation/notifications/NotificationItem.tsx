import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { plainDescription, plainTaskTitle } from '@/lib/taskTitleBody';
import type { Notification, NotificationPayload } from '@/domain/notifications/Notification';
import { FeedRow } from '@/presentation/activity/FeedRow';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import type { NotificationActions } from './useNotificationActions';

const roleLabel: Record<'editor' | 'viewer', string> = {
  editor: 'редактор',
  viewer: 'наблюдатель',
};

// Сервер кладёт в уведомление кусок description как есть — с картинками-`<figure>` редактора
// и markdown. Показываем то, что человек видит на карточке: заголовок задачи…
function taskLabel(excerpt: string | null | undefined): string {
  return (excerpt ? plainTaskTitle(excerpt) : '') || '(без описания)';
}

// …а фрагменты (превью задачи, комментарий, сообщение) — одной строкой без HTML и разметки.
function plainExcerpt(excerpt: string | null | undefined): string {
  return excerpt ? plainDescription(excerpt) : '';
}

function Who({ name }: { name: string }): React.ReactElement {
  return <span className="text-foreground">{name}</span>;
}

// Уведомление в две строки ленты: о чём (задача, проект, чат) и «кто · что сделал».
type NotificationView = {
  readonly avatarName: string;
  readonly subject: string;
  readonly meta: React.ReactNode;
  readonly metaTitle: string;
  // Справа от названия, до времени: «уточнение» у упоминаний в задаче, ждущей ответа.
  readonly chip?: React.ReactNode;
  // Под строками — то, что нельзя обрезать: детали изменения задачи.
  readonly details?: React.ReactNode;
};

function describe(payload: NotificationPayload): NotificationView {
  switch (payload.type) {
    case 'task_changed': {
      const actor = payload.actorDisplayName;
      return {
        avatarName: actor,
        subject: taskLabel(payload.taskExcerpt),
        meta: (
          <>
            <Who name={actor} /> · <span>{payload.title}</span> · {payload.projectName}
          </>
        ),
        metaTitle: `${actor} · ${payload.title} · ${payload.projectName}`,
        details: payload.detail ? (
          <p className="whitespace-pre-line text-meta leading-[1.125rem] text-muted-foreground">{payload.detail}</p>
        ) : undefined,
      };
    }
    case 'comment_mention': {
      const actor = payload.actorDisplayName ?? 'Кто-то';
      const comment = plainExcerpt(payload.commentExcerpt);
      return {
        avatarName: actor,
        subject: taskLabel(payload.taskExcerpt),
        meta: comment ? (
          <>
            <Who name={actor} /> упомянул вас: «{comment}»
          </>
        ) : (
          <>
            <Who name={actor} /> упомянул вас в «{payload.projectName}»
          </>
        ),
        metaTitle: comment ? `${actor}: «${comment}»` : `${actor} упомянул вас в «${payload.projectName}»`,
        chip:
          payload.taskStatus === 'awaiting_clarification' ? (
            <span
              className="shrink-0 rounded bg-manual-soft px-1 text-2xs font-medium text-manual-ink"
              title="Задача ждёт твоего ответа"
            >
              уточнение
            </span>
          ) : undefined,
      };
    }
    case 'project_invite':
      return {
        avatarName: payload.actorDisplayName,
        subject: payload.projectName,
        meta: (
          <>
            <Who name={payload.actorDisplayName ?? 'Кто-то'} /> приглашает вас как {roleLabel[payload.role]}
          </>
        ),
        metaTitle: `${payload.actorDisplayName ?? 'Кто-то'} приглашает вас в проект как ${roleLabel[payload.role]}`,
      };
    case 'workspace_invite':
      return {
        avatarName: payload.actorDisplayName,
        subject: payload.workspaceName,
        meta: (
          <>
            <Who name={payload.actorDisplayName ?? 'Кто-то'} /> приглашает в пространство как{' '}
            {roleLabel[payload.role]}
          </>
        ),
        metaTitle: `${payload.actorDisplayName ?? 'Кто-то'} приглашает в пространство как ${roleLabel[payload.role]}`,
      };
    case 'task_delegation':
    case 'task_assignee_changed': {
      const actor = payload.actorDisplayName ?? 'Кто-то';
      return {
        avatarName: payload.actorDisplayName,
        subject: taskLabel(payload.taskExcerpt),
        meta: (
          <>
            <Who name={actor} /> назначил(а) вас ответственным
          </>
        ),
        metaTitle: `${actor} назначил(а) вас ответственным`,
      };
    }
    case 'task_approval_requested':
      return {
        avatarName: payload.actorDisplayName,
        subject: taskLabel(payload.taskExcerpt),
        meta: (
          <>
            <Who name={payload.actorDisplayName} /> отметил(а) выполненной — ждёт вашего утверждения
          </>
        ),
        metaTitle: `${payload.actorDisplayName} отметил(а) задачу выполненной в «${payload.projectName}» — ждёт вашего утверждения`,
      };
    case 'task_delegation_resolved': {
      const verb = payload.resolution === 'declined' ? 'снял(а) с себя задачу' : 'принял(а) задачу';
      return {
        avatarName: payload.actorDisplayName,
        subject: taskLabel(payload.taskExcerpt),
        meta: (
          <>
            <Who name={payload.actorDisplayName} /> {verb}
          </>
        ),
        metaTitle: `${payload.actorDisplayName} ${verb}`,
      };
    }
    case 'task_assigned_to_project':
      return {
        avatarName: payload.actorDisplayName,
        subject: taskLabel(payload.taskExcerpt),
        meta: (
          <>
            <Who name={payload.actorDisplayName} /> перенёс(ла) в «{payload.projectName}»
          </>
        ),
        metaTitle: `${payload.actorDisplayName} перенёс(ла) задачу, за которую вы отвечаете, в «${payload.projectName}»`,
      };
    case 'chat_mention': {
      const actor = payload.actorDisplayName ?? 'Кто-то';
      const message = plainExcerpt(payload.messageExcerpt);
      return {
        avatarName: payload.actorDisplayName,
        subject: `Чат «${payload.workspaceName}»`,
        meta: message ? (
          <>
            <Who name={actor} />: «{message}»
          </>
        ) : (
          <>
            <Who name={actor} /> упомянул(а) вас
          </>
        ),
        metaTitle: message ? `${actor}: «${message}»` : `${actor} упомянул(а) вас`,
      };
    }
    case 'server_alert': {
      const icon = payload.alertStatus === 'resolved' ? '✅' : payload.severity === 'critical' ? '🔴' : '🟠';
      return {
        avatarName: payload.serverName,
        subject: `${icon} ${payload.serverName}`,
        meta: `${payload.message} · «${payload.projectName}»`,
        metaTitle: `${payload.message} · «${payload.projectName}»`,
      };
    }
    case 'daily_digest':
      return {
        avatarName: payload.projectName,
        subject: '🗂️ Ежедневная сводка',
        meta: `«${payload.projectName}» · ${payload.taskCount} задач`,
        metaTitle: `«${payload.projectName}» · ${payload.taskCount} задач`,
      };
    case 'support_ticket': {
      const from = `${payload.submitterDisplayName ?? 'Аноним'}${payload.source === 'landing' ? ' · с лендинга' : ''}`;
      const text = from + (payload.messageExcerpt ? `: «${payload.messageExcerpt}»` : '');
      return {
        avatarName: payload.submitterDisplayName ?? 'Поддержка',
        subject: '🆘 Обращение в поддержку',
        meta: text,
        metaTitle: text,
      };
    }
    case 'join_request': {
      const requester = payload.requesterDisplayName ?? 'Пользователь';
      return {
        avatarName: payload.actorDisplayName,
        subject: payload.projectName,
        meta: (
          <>
            <Who name={requester} /> просит доступ к проекту
          </>
        ),
        metaTitle: `${requester} просит доступ к проекту «${payload.projectName}»`,
      };
    }
  }
}

// Строка уведомления в ленте «Все»/«Требуется действие» (дизайн C4, плотная): две строки
// с обрезкой, под ними — только детали изменения и кнопки (принять инвайт/join-request).
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
  const view = describe(payload);
  // Кнопки — в рост плотной строки (24px); под палец — 36px.
  const buttonClass = 'h-6 gap-1 px-2 text-xs [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:px-3';

  let controls: React.ReactNode = null;
  if (payload.type === 'project_invite' || payload.type === 'workspace_invite') {
    controls =
      actionUi === 'accepted' ? (
        <p className="pbs-0.5 text-meta font-medium text-done">✓ Принято</p>
      ) : actionUi === 'resolved' ? (
        <p className="pbs-0.5 text-meta text-muted-foreground">Уже обработано</p>
      ) : (
        <div className="pbs-1">
          <Button
            size="sm"
            className={buttonClass}
            disabled={actionUi === 'busy'}
            onClick={(e) => {
              e.stopPropagation();
              if (payload.type === 'project_invite') actions.handleAcceptInvite(n);
              else actions.handleAcceptWorkspaceInvite(n);
            }}
          >
            Принять
          </Button>
        </div>
      );
  } else if (payload.type === 'join_request') {
    controls =
      actionUi === 'accepted' ? (
        <p className="pbs-0.5 text-meta font-medium text-done">✓ Доступ предоставлен</p>
      ) : actionUi === 'declined' ? (
        <p className="pbs-0.5 text-meta text-muted-foreground">Запрос отклонён</p>
      ) : (
        <div className="flex gap-1.5 pbs-1">
          <Button
            size="sm"
            className={buttonClass}
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
            className={buttonClass}
            disabled={actionUi === 'busy'}
            onClick={(e) => {
              e.stopPropagation();
              actions.handleResolveJoin(n, false);
            }}
          >
            Отклонить
          </Button>
        </div>
      );
  }

  return (
    <FeedRow
      onClick={() => actions.handleClick(n)}
      className={cn('cursor-pointer', isUnread ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-hover')}
      createdAt={n.createdAt}
      subject={view.subject}
      subjectTitle={view.subject}
      meta={view.meta}
      metaTitle={view.metaTitle}
      badge={view.chip}
      avatar={
        <>
          <UserAvatar displayName={view.avatarName} className="size-5 rounded-full text-[9px]" />
          {/* Непрочитанное — точка на углу аватара (выделяет иконку). */}
          {isUnread && (
            <span
              className="absolute -end-0.5 -inset-bs-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
              aria-hidden
            />
          )}
        </>
      }
    >
      {view.details}
      {/* Задача из payload'а в корзине: текст уведомления сохраняем, но предупреждаем, что
          перехода не будет — иначе клик выглядел бы поломкой. */}
      {n.taskDeleted && <p className="text-meta text-muted-foreground">🗑️ Задача удалена</p>}
      {controls}
    </FeedRow>
  );
}
