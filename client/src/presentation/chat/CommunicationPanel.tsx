import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useActionableUnreadCount } from '@/presentation/hooks/useActionableUnreadCount';
import { useActivityFeed } from '@/presentation/hooks/useActivityFeed';
import { NotificationItem } from '@/presentation/notifications/NotificationItem';
import { useNotificationActions } from '@/presentation/notifications/useNotificationActions';
import { ActivityItem } from '@/presentation/activity/ActivityItem';
import { WorkspaceChatPanel } from './WorkspaceChatPanel';

type CommTab = 'all' | 'action' | 'chat';
const STORAGE_KEY = 'pf_comm_tab';

function readTab(): CommTab {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'all' || v === 'action' || v === 'chat') return v;
  } catch {
    /* localStorage недоступен */
  }
  return 'all';
}

// Панель общения в сайдбаре: переключалка Все / Требуется действие / Чат.
// «Все» и «Требуется действие» — лента активности пространства; «Чат» — общий чат.
export function CommunicationPanel(): React.ReactElement {
  const [tab, setTab] = useState<CommTab>(readTab);
  const { count: actionable } = useActionableUnreadCount();

  const select = (t: CommTab): void => {
    setTab(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 rounded-md border bg-card p-0.5 text-xs">
        <TabButton active={tab === 'all'} onClick={() => select('all')}>
          Все
        </TabButton>
        <TabButton active={tab === 'action'} onClick={() => select('action')} badge={actionable}>
          Действие
        </TabButton>
        <TabButton active={tab === 'chat'} onClick={() => select('chat')}>
          Чат
        </TabButton>
      </div>

      <div className="mt-2 min-h-0 flex-1">
        {tab === 'chat' ? <WorkspaceChatPanel /> : <ActivityFeedList tab={tab} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 transition active:scale-95',
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium',
            active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/15 text-primary',
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function ActivityFeedList({ tab }: { tab: 'all' | 'action' }): React.ReactElement {
  const { workspace } = useCurrentWorkspace();
  const feed = useActivityFeed(workspace?.id ?? null, tab);
  // Действия над уведомлениями (принять/отклонить и т.п.) → после изменения рефетчим ленту.
  const actions = useNotificationActions({ onChanged: feed.refresh });

  if (feed.loading) {
    return (
      <div className="space-y-2 px-1 py-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (feed.error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive">
        Не удалось загрузить ленту.
      </div>
    );
  }

  if (feed.items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {tab === 'action' ? 'Нет дел, требующих действия.' : 'Здесь появятся действия по проектам пространства.'}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {feed.items.map((it) =>
          it.type === 'activity' ? (
            <ActivityItem key={it.id} item={it} />
          ) : (
            <NotificationItem key={it.notification.id} n={it.notification} actions={actions} />
          ),
        )}
      </ul>
      {feed.hasMore && (
        <button
          type="button"
          onClick={feed.loadMore}
          className="mt-2 w-full rounded-md py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Загрузить ещё
        </button>
      )}
    </div>
  );
}
