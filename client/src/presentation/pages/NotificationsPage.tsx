import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Notification } from '@/domain/notifications/Notification';
import { useContainer } from '@/infrastructure/di/container';
import { useUnreadNotificationsCount } from '@/presentation/hooks/useUnreadNotificationsCount';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { NotificationItem } from '@/presentation/notifications/NotificationItem';
import { useNotificationActions } from '@/presentation/notifications/useNotificationActions';

type FilterMode = 'all' | 'unread';

export function NotificationsPage(): React.ReactElement {
  const { notificationRepository } = useContainer();
  const { refresh: refreshBadge } = useUnreadNotificationsCount();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('all');

  // Оптимистичный апдейт строки (mark-read и т.п.) — без полного рефетча.
  const actions = useNotificationActions({
    patchItem: (id, patch) => setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
  });

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

  const markAllRead = async (): Promise<void> => {
    try {
      const updated = await notificationRepository.markAllRead();
      if (updated === 0) {
        toast.success('Всё уже прочитано');
        return;
      }
      const now = new Date();
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      refreshBadge();
      toast.success(`Прочитано: ${updated}`);
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const unreadCount = items.filter((n) => n.readAt === null).length;

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Bell className="size-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Уведомления</h1>
        </div>
        <div className="flex items-center gap-2">
          <FilterToggle value={filter} onChange={setFilter} unreadCount={unreadCount} />
          <Button size="sm" variant="outline" onClick={() => void markAllRead()} disabled={loading || unreadCount === 0}>
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
            <NotificationItem key={n.id} n={n} actions={actions} />
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
    <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 text-xs" role="group" aria-label="Фильтр">
      <FilterButton active={value === 'all'} onClick={() => onChange('all')}>
        Все
      </FilterButton>
      <FilterButton active={value === 'unread'} onClick={() => onChange('unread')}>
        Непрочитанные
        {unreadCount > 0 && (
          <span
            className={cn(
              'ml-1 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-medium',
              value === 'unread' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/15 text-primary',
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
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
