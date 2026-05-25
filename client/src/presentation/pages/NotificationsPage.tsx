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
import { NOTIFICATIONS_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { getInitials } from '@/presentation/layout/projectIcons';

const roleLabel: Record<'editor' | 'viewer', string> = {
  editor: 'редактор',
  viewer: 'наблюдатель',
};

type FilterMode = 'all' | 'unread';

// Простой relative-time formatter. Для большего нашлось бы date-fns/relative-time-format,
// но ради двух строк не нужна зависимость.
function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - date.getTime());
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'только что';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function NotificationsPage(): React.ReactElement {
  const { notificationRepository, inviteRepository, projectRepository } = useContainer();
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
    // project_invite: переход — по кнопке «Принять» (handleAcceptInvite), не по строке.
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
          <h1 className="text-3xl font-semibold tracking-tight">Уведомления</h1>
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
}: {
  n: Notification;
  onClick: () => void;
  onAccept: () => void;
  onResolveJoin: (accept: boolean) => void;
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
          {getInitials(payload.actorDisplayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-0.5">
        {payload.type === 'comment_mention' && (
          <>
            <p className="text-sm leading-snug">
              <span className="font-medium">{payload.actorDisplayName}</span> упомянул тебя в{' '}
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
              <span className="font-medium">{payload.actorDisplayName}</span> приглашает вас в{' '}
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

        {payload.type === 'join_request' && (
          <>
            <p className="text-sm leading-snug">
              <span className="font-medium">{payload.requesterDisplayName}</span> просит доступ к
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
