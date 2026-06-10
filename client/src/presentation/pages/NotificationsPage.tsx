import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Notification } from '@/domain/notifications/Notification';
import { useContainer } from '@/infrastructure/di/container';
import { useUnreadNotificationsCount } from '@/presentation/hooks/useUnreadNotificationsCount';
import { relativeTime } from '@/lib/relativeTime';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { getInitials } from '@/presentation/layout/projectIcons';

const roleLabel: Record<'editor' | 'viewer', string> = {
  editor: 'редактор',
  viewer: 'наблюдатель',
};

type FilterMode = 'all' | 'unread';

export function NotificationsPage(): React.ReactElement {
  const { notificationRepository, inviteRepository, projectRepository, taskDelegationRepository } =
    useContainer();
  const navigate = useNavigate();
  const { refresh: refreshBadge } = useUnreadNotificationsCount();
  const { applyAppend } = useProjectsContext();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    notificationRepository
      .list({ unreadOnly: filter === 'unread', limit: 100 })
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Не удалось загрузить: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, notificationRepository]);

  const markRead = async (n: Notification): Promise<void> => {
    if (n.readAt !== null) return;
    try {
      await notificationRepository.markRead(n.id);
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date() } : x)),
      );
      // Дёргаем глобальный event — все instance'ы useUnreadNotificationsCount
      // (включая sidebar) сами пересчитают; иначе бейдж в боковой панели остаётся
      // stale до следующего 60s-polling'а.
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      refreshBadge();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const markAllRead = async (): Promise<void> => {
    try {
      const updated = await notificationRepository.markAllRead();
      if (updated === 0) {
        toast.success('Всё уже прочитано');
        return;
      }
      // Локально проставляем readAt у всех unread.
      const now = new Date();
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      refreshBadge();
      toast.success(`Прочитано: ${updated}`);
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleClick = async (n: Notification): Promise<void> => {
    // Помечаем прочитанным + переходим на проект/задачу. Глубокий линк task→диалог
    // оставлен на потом — пока ведём на доску.
    await markRead(n);
    if (n.payload.type === 'comment_mention' || n.payload.type === 'join_request') {
      navigate(`/projects/${n.payload.projectId}`);
    }
    if (
      n.payload.type === 'task_delegation' ||
      n.payload.type === 'task_delegation_resolved'
    ) {
      // Ведём на inbox — там видны pending и обычный список с метками делегирования.
      navigate('/inbox');
    }
    if (n.payload.type === 'task_assigned_to_project') {
      navigate(`/projects/${n.payload.projectId}`);
    }
    if (n.payload.type === 'server_alert') {
      navigate(`/projects/${n.payload.projectId}/monitoring`);
    }
    if (n.payload.type === 'daily_digest') {
      navigate(`/projects/${n.payload.projectId}`);
    }
    // project_invite: переход — по кнопке «Принять» (handleAcceptInvite), не по строке.
  };

  const handleAcceptDelegation = async (n: Notification): Promise<void> => {
    if (n.payload.type !== 'task_delegation') return;
    const taskId = n.payload.taskId;
    try {
      await taskDelegationRepository.accept(n.payload.delegationId);
      await markRead(n);
      toast.success('Задача принята');
      // Открываем задачу сразу — deep-link `?task=<id>` подхватывается
      // KanbanBoard/TaskListView и открывает drawer.
      navigate(`/inbox?task=${taskId}`);
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleDeclineDelegation = async (n: Notification): Promise<void> => {
    if (n.payload.type !== 'task_delegation') return;
    try {
      await taskDelegationRepository.decline(n.payload.delegationId);
      await markRead(n);
      toast.success('Задача отклонена');
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleResolveJoin = async (n: Notification, accept: boolean): Promise<void> => {
    if (n.payload.type !== 'join_request') return;
    try {
      await projectRepository.resolveJoinRequest(n.payload.joinRequestId, accept);
      await markRead(n);
      toast.success(accept ? 'Доступ предоставлен' : 'Запрос отклонён');
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleAcceptInvite = async (n: Notification): Promise<void> => {
    if (n.payload.type !== 'project_invite') return;
    const { token, projectId } = n.payload;
    try {
      await inviteRepository.accept(token);
      await markRead(n);
      // Подтягиваем проект в список сайдбара без перезагрузки.
      const project = await projectRepository.getById(projectId).catch(() => null);
      if (project) applyAppend(project);
      toast.success(`Вы присоединились к «${n.payload.projectName}»`);
      navigate(`/projects/${projectId}`);
    } catch (e) {
      toast.error(`Не удалось принять приглашение: ${(e as Error).message}`);
    }
  };

  const unreadCount = items.filter((n) => n.readAt === null).length;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bell className="size-7 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Уведомления</h1>
        </div>
        <div className="flex items-center gap-2">
          <FilterToggle value={filter} onChange={setFilter} unreadCount={unreadCount} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void markAllRead()}
            disabled={loading || unreadCount === 0}
          >
            <CheckCheck className="size-4" />
            Прочитать всё
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 py-12 text-center text-sm text-muted-foreground">
          {filter === 'unread' ? 'Непрочитанных уведомлений нет.' : 'Уведомлений ещё нет.'}
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onClick={() => void handleClick(n)}
              onAccept={() => void handleAcceptInvite(n)}
              onResolveJoin={(accept) => void handleResolveJoin(n, accept)}
              onAcceptDelegation={() => void handleAcceptDelegation(n)}
              onDeclineDelegation={() => void handleDeclineDelegation(n)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterToggle({
  value,
  onChange,
  unreadCount,
}: {
  value: FilterMode;
  onChange: (v: FilterMode) => void;
  unreadCount: number;
}): React.ReactElement {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 text-xs"
      role="group"
      aria-label="Фильтр"
    >
      <FilterButton active={value === 'all'} onClick={() => onChange('all')}>
        Все
      </FilterButton>
      <FilterButton active={value === 'unread'} onClick={() => onChange('unread')}>
        Непрочитанные
        {unreadCount > 0 && (
          <span
            className={cn(
              'ml-1 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-medium',
              value === 'unread'
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : 'bg-primary/15 text-primary',
            )}
          >
            {unreadCount}
          </span>
        )}
      </FilterButton>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded px-2.5 py-1 transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function NotificationRow({
  n,
  onClick,
  onAccept,
  onResolveJoin,
  onAcceptDelegation,
  onDeclineDelegation,
}: {
  n: Notification;
  onClick: () => void;
  onAccept: () => void;
  onResolveJoin: (accept: boolean) => void;
  onAcceptDelegation: () => void;
  onDeclineDelegation: () => void;
}): React.ReactElement {
  const isUnread = n.readAt === null;
  const payload = n.payload;

  return (
    <li
      onClick={onClick}
      className={cn(
        'group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors',
        isUnread ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/40',
      )}
    >
      {/* Точка-индикатор слева — мгновенно понятно что unread. */}
      <span
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          isUnread ? 'bg-primary' : 'bg-transparent',
        )}
        aria-hidden
      />
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="text-[11px]">
          {getInitials(
            payload.type === 'server_alert'
              ? payload.serverName
              : payload.type === 'daily_digest'
                ? payload.projectName
                : payload.actorDisplayName,
          )}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-0.5">
        {payload.type === 'comment_mention' && (
          <>
            <p className="text-sm leading-snug">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> упомянул тебя в{' '}
              <span className="font-medium">«{payload.projectName}»</span>
              {payload.taskStatus === 'awaiting_clarification' && (
                <>
                  {' '}
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
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
              <p className="line-clamp-2 text-xs text-muted-foreground">
                «{payload.commentExcerpt}»
              </p>
            )}
          </>
        )}

        {payload.type === 'project_invite' && (
          <>
            <p className="text-sm leading-snug">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> приглашает вас в{' '}
              <span className="font-medium">«{payload.projectName}»</span> как{' '}
              {roleLabel[payload.role]}
            </p>
            <div className="pt-1">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept();
                }}
              >
                Принять
              </Button>
            </div>
          </>
        )}

        {payload.type === 'task_delegation' && (
          <>
            <p className="text-sm leading-snug">
              <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> делегировал вам задачу:
            </p>
            <p className="line-clamp-2 text-xs italic text-muted-foreground">
              «{payload.taskExcerpt || '(без описания)'}»
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptDelegation();
                }}
              >
                Принять
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeclineDelegation();
                }}
              >
                Отклонить
              </Button>
            </div>
          </>
        )}

        {payload.type === 'task_delegation_resolved' && (
          <p className="text-sm leading-snug">
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
          <p className="text-sm leading-snug">
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
          <p className="text-sm leading-snug">
            {payload.alertStatus === 'resolved' ? '✅ ' : payload.severity === 'critical' ? '🔴 ' : '🟠 '}
            <span className="font-medium">{payload.serverName}</span>
            {' · '}
            {payload.message}
            {' · '}
            <span className="text-muted-foreground">«{payload.projectName}»</span>
          </p>
        )}

        {payload.type === 'daily_digest' && (
          <p className="text-sm leading-snug">
            🗂️ Ежедневная сводка по{' '}
            <span className="font-medium">«{payload.projectName}»</span>
            {' · '}
            {payload.taskCount} задач
          </p>
        )}

        {payload.type === 'join_request' && (
          <>
            <p className="text-sm leading-snug">
              <span className="font-medium">{payload.requesterDisplayName ?? 'Пользователь'}</span> просит доступ к
              проекту <span className="font-medium">«{payload.projectName}»</span>
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveJoin(true);
                }}
              >
                Принять
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveJoin(false);
                }}
              >
                Отклонить
              </Button>
            </div>
          </>
        )}

        <p className="text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</p>
      </div>
    </li>
  );
}
