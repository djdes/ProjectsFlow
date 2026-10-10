import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useActionableUnreadCount } from '@/presentation/hooks/useActionableUnreadCount';
import { useActiveChatUnread } from '@/presentation/hooks/useChatRooms';
import { useActivityFeed } from '@/presentation/hooks/useActivityFeed';
import { NotificationItem } from '@/presentation/notifications/NotificationItem';
import { useNotificationActions } from '@/presentation/notifications/useNotificationActions';
import { ActivityItem } from '@/presentation/activity/ActivityItem';
import { AiConversationListPanel } from '@/presentation/components/ai/AiConversationListPanel';
import { OPEN_CHAT_EVENT } from './openChatEvent';
import { WorkspaceChatPanel } from './WorkspaceChatPanel';

type CommTab = 'all' | 'action' | 'chat' | 'ai';
const STORAGE_KEY = 'pf_comm_tab';

function readTab(): CommTab {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'all' || v === 'action' || v === 'chat' || v === 'ai') return v;
  } catch {
    /* localStorage недоступен */
  }
  return 'all';
}

// Панель общения в сайдбаре: единая поверхность Все / Действие / Чат / ИИ.
export function CommunicationPanel(): React.ReactElement {
  const [tab, setTab] = useState<CommTab>(readTab);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Счётчики на вкладках = слагаемые бейджа на rail-иконке «Чат» (chatUnread + actionable),
  // чтобы «3» на иконке всегда сводилось к конкретной вкладке (иначе непонятно, где эти уведомления).
  const { count: actionable } = useActionableUnreadCount();
  const chatUnread = useActiveChatUnread();

  const select = (t: CommTab): void => {
    setTab(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
    if (t === 'ai' && pathname !== '/ai' && !pathname.startsWith('/ai/')) navigate('/ai');
  };

  // Прямой URL/Back к ИИ-чату раскрывает раздел общения и его вкладку ИИ.
  useEffect(() => {
    if (pathname === '/ai' || pathname.startsWith('/ai/')) {
      setTab('ai');
      try {
        localStorage.setItem(STORAGE_KEY, 'ai');
      } catch {
        /* ignore */
      }
    }
  }, [pathname]);

  // chat_mention: внешний сигнал «открой чат» — переключаем вкладку панели.
  useEffect(() => {
    const onOpenChat = (): void => {
      setTab('chat');
      try {
        localStorage.setItem(STORAGE_KEY, 'chat');
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpenChat);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpenChat);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-foreground/[0.06] dark:border dark:border-border dark:bg-panel p-0.5 text-xs">
        <TabButton active={tab === 'all'} onClick={() => select('all')}>
          Все
        </TabButton>
        <TabButton active={tab === 'action'} onClick={() => select('action')} badge={actionable}>
          Действие
        </TabButton>
        <TabButton active={tab === 'chat'} onClick={() => select('chat')} badge={chatUnread}>
          Чат
        </TabButton>
        <TabButton active={tab === 'ai'} onClick={() => select('ai')}>
          ИИ
        </TabButton>
      </div>

      <div className="mbs-2 min-h-0 flex-1">
        {tab === 'ai' ? (
          <AiConversationListPanel />
        ) : tab === 'chat' ? (
          <WorkspaceChatPanel />
        ) : (
          <ActivityFeedList tab={tab} />
        )}
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
        // Вид SegmentedControl (C4): выбранная вкладка — белая плашка, а не синяя заливка.
        'inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 transition-[color,background-color,border-color,box-shadow,opacity] motion-safe:transition motion-safe:active:scale-95',
        active ? 'font-medium bg-background text-foreground shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary-soft px-1 text-[10px] font-medium tabular-nums text-primary-ink">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function ActivityFeedList({ tab }: { tab: 'all' | 'action' }): React.ReactElement {
  const { workspace } = useCurrentWorkspace();
  const feed = useActivityFeed(workspace?.id ?? null, tab);
  // Пометку прочитанным/действия применяем ТОЧЕЧНО в ленте (patchItem), без полного рефетча —
  // иначе клик по строке сбрасывал «загрузить ещё» и скроллил ленту вверх. Реально новые
  // строки подтянет live-рефетч (useActivityFeed слушает те же события, сохраняя окно/скролл).
  const actions = useNotificationActions({ patchItem: feed.patchItem });

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
      <ul className="divide-y overflow-clip rounded-lg border bg-card">
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
          className="mbs-2 w-full rounded-md py-2 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          Загрузить ещё
        </button>
      )}
    </div>
  );
}
