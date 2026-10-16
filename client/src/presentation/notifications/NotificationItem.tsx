import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { plainDescription, plainTaskTitle } from '@/lib/taskTitleBody';
import type { Notification, NotificationPayload } from '@/domain/notifications/Notification';
import { FEED_AVATAR_CLASS, FeedRow } from '@/presentation/activity/FeedRow';
import { feedActorName, feedProjectName, notificationDetail, notificationKind } from '@/presentation/activity/feedKind';
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
// Служебный заголовок комментария бота («Оригинал сообщения:») в превью ничего не добавляет.
function plainExcerpt(excerpt: string | null | undefined): string {
  return excerpt ? plainDescription(excerpt).replace(/^Оригинал сообщения:\s*/u, '') : '';
}

function Who({ name }: { name: string }): React.ReactElement {
  return <span className="text-foreground">{name}</span>;
}

// Уведомление в три строки ленты: что это и где (метка вида + проект), о чём (задача, проект,
// чат) и «кто · что сделал». Вид события — метка, поэтому в тексте его не повторяем.
type NotificationView = {
  readonly avatarName: string;
  readonly context?: string;
  readonly subject: string;
  readonly meta: React.ReactNode;
  readonly metaTitle: string;
  // Справа от названия: «уточнение» у упоминаний в задаче, ждущей ответа.
  readonly chip?: React.ReactNode;
  // Под строками — то, что нельзя обрезать: детали изменения задачи.
  readonly details?: React.ReactNode;
};

function describe(payload: NotificationPayload): NotificationView {
  switch (payload.type) {
    case 'task_changed': {
      const actor = feedActorName(payload.actorDisplayName) || 'Кто-то';
      const comment = payload.action === 'commented' ? plainExcerpt(payload.detail) : '';
      const detail = comment ? '' : notificationDetail(payload.action, payload.detail);
      return {
        avatarName: actor,
        context: feedProjectName(payload.projectName),
        subject: taskLabel(payload.taskExcerpt),
        meta: comment ? (
          <>
            <Who name={actor} />: «{comment}»
          </>
        ) : (
          <Who name={actor} />
        ),
        metaTitle: comment ? `${actor}: «${comment}»` : `${actor} · ${payload.title}`,
        details: detail ? (
          <p title={payload.detail} className="truncate text-meta leading-[1.125rem] text-muted-foreground">
            {detail}
          </p>
        ) : undefined,
      };
    }
    case 'comment_mention': {
      const actor = feedActorName(payload.actorDisplayName) || 'Кто-то';
      const comment = plainExcerpt(payload.commentExcerpt);
      return {
        avatarName: actor,
        context: feedProjectName(payload.projectName),
        subject: taskLabel(payload.taskExcerpt),
        meta: comment ? (
          <>
            <Who name={actor} />: «{comment}»
          </>
        ) : (
          <>
            <Who name={actor} /> упомянул(а) вас
          </>
        ),
        metaTitle: comment ? `${actor}: «${comment}»` : `${actor} упомянул(а) вас`,
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
    case 'project_invite': {
      const actor = payload.actorDisplayName ?? 'Кто-то';
      return {
        avatarName: actor,
        context: 'проект',
        subject: payload.projectName,
        meta: (
          <>
            <Who name={actor} /> приглашает вас как {roleLabel[payload.role]}
          </>
        ),
        metaTitle: `${actor} приглашает вас в проект как ${roleLabel[payload.role]}`,
      };
    }
    case 'workspace_invite': {
      const actor = payload.actorDisplayName ?? 'Кто-то';
      return {
        avatarName: actor,
        context: 'пространство',
        subject: payload.workspaceName,
        meta: (
          <>
            <Who name={actor} /> приглашает вас как {roleLabel[payload.role]}
          </>
        ),
        metaTitle: `${actor} приглашает в пространство как ${roleLabel[payload.role]}`,
      };
    }
    case 'task_delegation':
    case 'task_assignee_changed': {
      const actor = payload.actorDisplayName ?? 'Кто-то';
      return {
        avatarName: actor,
        context:
          payload.type === 'task_assignee_changed'
            ? payload.isInbox
              ? 'Входящие'
              : feedProjectName(payload.projectName)
            : undefined,
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
        context: feedProjectName(payload.projectName),
        subject: taskLabel(payload.taskExcerpt),
        meta: (
          <>
            <Who name={payload.actorDisplayName} /> выполнил(а) — ждёт вашего утверждения
          </>
        ),
        metaTitle: `${payload.actorDisplayName} отметил(а) задачу выполненной — ждёт вашего утверждения`,
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
        context: feedProjectName(payload.projectName),
        subject: taskLabel(payload.taskExcerpt),
        meta: (
          <>
            <Who name={payload.actorDisplayName} /> перенёс(ла) задачу, за которую вы отвечаете
          </>
        ),
        metaTitle: `${payload.actorDisplayName} перенёс(ла) задачу, за которую вы отвечаете, в «${feedProjectName(payload.projectName)}»`,
      };
    case 'chat_mention': {
      const actor = payload.actorDisplayName ?? 'Кто-то';
      const message = plainExcerpt(payload.messageExcerpt);
      return {
        avatarName: actor,
        context: payload.workspaceName,
        subject: message || 'Сообщение в чате',
        meta: (
          <>
            <Who name={actor} /> упомянул(а) вас в чате
          </>
        ),
        metaTitle: message ? `${actor}: «${message}»` : `${actor} упомянул(а) вас в чате`,
      };
    }
    case 'server_alert':
      return {
        avatarName: payload.serverName,
        context: feedProjectName(payload.projectName),
        subject: payload.serverName,
        meta: payload.message,
        metaTitle: payload.message,
      };
    case 'daily_digest':
      return {
        avatarName: payload.projectName,
        context: feedProjectName(payload.projectName),
        subject: 'Сводка задач за день',
        meta: `${payload.taskCount} задач`,
        metaTitle: `«${feedProjectName(payload.projectName)}» · ${payload.taskCount} задач`,
      };
    case 'support_ticket': {
      const from = payload.submitterDisplayName ?? 'Аноним';
      return {
        avatarName: payload.submitterDisplayName ?? 'Поддержка',
        context: payload.source === 'landing' ? 'с лендинга' : 'из приложения',
        subject: payload.messageExcerpt || 'Обращение в поддержку',
        meta: <Who name={from} />,
        metaTitle: payload.messageExcerpt ? `${from}: «${payload.messageExcerpt}»` : from,
      };
    }
    case 'join_request': {
      const requester = payload.requesterDisplayName ?? 'Пользователь';
      return {
        avatarName: requester,
        context: 'проект',
        subject: payload.projectName,
        meta: (
          <>
            <Who name={requester} /> просит доступ к проекту
          </>
        ),
        metaTitle: `${requester} просит доступ к проекту «${payload.projectName}»`,
      };
    }
    default:
      return { avatarName: '', subject: 'Уведомление', meta: '', metaTitle: '' };
  }
}

// Строка уведомления в колокольчике и ленте «Все»/«Действие» (дизайн C4): метка вида, о чём
// и кто; под строками — только детали изменения и кнопки (принять инвайт/join-request).
export function NotificationItem({
  n,
  actions,
}: {
  n: Notification;
  actions: NotificationActions;
}): React.ReactElement {
  const isUnread = n.readAt === null;
  const payload = n.payload;
  // Ответ уже есть: свой клик в этой сессии или живое состояние с сервера (запрос приняли
  // другие, по приглашению вошли из письма, проект удалили) — тогда вместо кнопок итог.
  const actionUi =
    actions.actionUi[n.id] ?? (n.actionState && n.actionState !== 'pending' ? n.actionState : undefined);
  const view = describe(payload);
  const kind = notificationKind(payload);
  // Кнопки — в рост плотной строки (24px); под палец — 36px.
  const buttonClass = 'h-6 gap-1 px-2 text-xs [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:px-3';

  let controls: React.ReactNode = null;
  if (payload.type === 'project_invite' || payload.type === 'workspace_invite') {
    controls =
      actionUi === 'accepted' ? (
        <p className="pbs-0.5 text-meta font-medium text-done">✓ Принято</p>
      ) : actionUi === 'resolved' ? (
        <p className="pbs-0.5 text-meta text-muted-foreground">Уже обработано</p>
      ) : actionUi === 'expired' || actionUi === 'declined' ? (
        <p className="pbs-0.5 text-meta text-muted-foreground">Приглашение больше не действует</p>
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
      ) : actionUi === 'expired' || actionUi === 'resolved' ? (
        <p className="pbs-0.5 text-meta text-muted-foreground">Запрос больше не актуален</p>
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
      kind={kind}
      context={view.context}
      unread={isUnread}
      onMarkRead={() => void actions.markRead(n)}
      subject={view.subject}
      subjectTitle={view.subject}
      meta={view.meta}
      metaTitle={view.metaTitle}
      badge={view.chip}
      avatar={<UserAvatar displayName={view.avatarName} className={FEED_AVATAR_CLASS} />}
    >
      {view.details}
      {/* Задача из payload'а в корзине: текст уведомления сохраняем, но предупреждаем, что
          перехода не будет — иначе клик выглядел бы поломкой. */}
      {n.taskDeleted && <p className="text-meta text-muted-foreground">🗑️ Задача удалена</p>}
      {controls}
    </FeedRow>
  );
}
