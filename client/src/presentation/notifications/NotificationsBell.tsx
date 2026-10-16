import { useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { toast } from '@/components/ui/sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { Notification } from '@/domain/notifications/Notification';
import { useContainer } from '@/infrastructure/di/container';
import { AnimatedBell } from '@/presentation/components/nav/AnimatedNavIcons';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { NotificationItem } from './NotificationItem';
import {
  markNotificationsSeen,
  readNotificationScope,
  saveNotificationScope,
  useNotificationBadge,
  type NotificationScope,
} from './useNotificationBadge';
import { useNotificationActions, type NotificationActions } from './useNotificationActions';
import { useNotificationsList, type NotificationsFilter } from './useNotificationsList';

const SCOPES = [
  { value: 'mine', label: 'Для меня' },
  { value: 'all', label: 'Все' },
] as const;

function isInvite(n: Notification): boolean {
  return n.payload.type === 'project_invite' || n.payload.type === 'workspace_invite';
}

// Колокольчик: приглашения, упоминания, изменения задач и прочее, что адресовано лично мне.
// header — шапка сайдбара рядом с пространством; rail — свёрнутая панель.
export function NotificationsBell({ variant = 'header' }: { variant?: 'header' | 'rail' }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const badge = useNotificationBadge();

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) markNotificationsSeen();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        type="button"
        aria-label={badge > 0 ? `Уведомления: ${badge} новых` : 'Уведомления'}
        title="Уведомления"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn(
          'relative grid shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-active data-[state=open]:text-foreground',
          variant === 'rail' ? 'size-9' : 'size-8 max-md:size-11',
        )}
      >
        <AnimatedBell className={variant === 'rail' ? 'size-4' : 'size-5'} active={hover || open} />
        {badge > 0 && (
          // Стиль и «99+» — как у бейджей рейла, чтобы счётчики панели выглядели одинаково.
          <span className="pointer-events-none absolute -end-0.5 -inset-bs-0.5 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] tabular-nums text-primary-foreground">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={variant === 'rail' ? 'right' : 'bottom'}
        align="start"
        className="w-[min(24rem,calc(100vw-1.5rem))] p-0"
      >
        <NotificationsPanel onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function NotificationsPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const { notificationRepository } = useContainer();
  const [scope, setScope] = useState<NotificationScope>(readNotificationScope);
  const [filter, setFilter] = useState<NotificationsFilter>('all');
  const list = useNotificationsList(filter, scope);
  const changeScope = (next: NotificationScope): void => {
    setScope(next);
    saveNotificationScope(next);
  };
  const base = useNotificationActions({ patchItem: list.patchItem });
  // Переход по уведомлению закрывает окно; по приглашению переходить некуда — ответ кнопкой.
  const actions: NotificationActions = {
    ...base,
    handleClick: (n) => {
      base.handleClick(n);
      if (!isInvite(n)) onClose();
    },
  };
  const hasUnread = list.items.some((n) => n.readAt === null);

  const markAllRead = (): void => {
    notificationRepository
      .markAllRead()
      .then(() => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT)))
      .catch((e: unknown) => toast.error(actionErrorMessage(e, 'Не удалось отметить уведомления прочитанными')));
  };

  return (
    <div className="flex flex-col">
      <div className="sticky inset-bs-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1.5 bg-popover px-3 pbs-2.5 pbe-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Уведомления</p>
        <button
          type="button"
          onClick={markAllRead}
          disabled={!hasUnread}
          aria-label="Прочитать все"
          title="Прочитать все"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 max-sm:size-10"
        >
          <CheckCheck className="size-4" />
        </button>
        {/* «Для меня» — личное и задачи, где я исполнитель или автор: лиду иначе приходит всё
            по проектам. Непрочитанные — отдельный переключатель поверх любого режима. */}
        <div className="flex w-full items-center gap-2">
          <SegmentedControl size="sm" options={SCOPES} value={scope} onChange={changeScope} />
          <button
            type="button"
            aria-pressed={filter === 'unread'}
            onClick={() => setFilter(filter === 'unread' ? 'all' : 'unread')}
            className={cn(
              'h-6 shrink-0 rounded-md px-2 text-xs transition-colors max-sm:h-9 max-sm:px-3',
              filter === 'unread'
                ? 'bg-active font-medium text-foreground'
                : 'text-muted-foreground hover:bg-hover hover:text-foreground',
            )}
          >
            Непрочитанные
          </button>
        </div>
      </div>

      <div className="px-1 pbe-1">
        {list.loading ? (
          <div className="space-y-1 p-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : list.error ? (
          <p className="px-3 py-8 text-center text-sm text-destructive">Не удалось загрузить уведомления.</p>
        ) : (
          <>
            {list.pending.length > 0 && (
              <section aria-label="Ждут ответа" className="pbe-1">
                <p className="px-2 pbs-1 pbe-0.5 text-xs font-medium text-muted-foreground">Ждут ответа</p>
                <ul className="flex flex-col gap-px">
                  {list.pending.map((n) => (
                    <NotificationItem key={n.id} n={n} actions={actions} />
                  ))}
                </ul>
              </section>
            )}
            {list.items.length > 0 ? (
              <ul
                className={cn(
                  'flex flex-col gap-px',
                  list.pending.length > 0 && 'border-bs border-border pbs-1',
                )}
              >
                {list.items.map((n) => (
                  <NotificationItem key={n.id} n={n} actions={actions} />
                ))}
              </ul>
            ) : (
              list.pending.length === 0 && (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  {filter === 'unread'
                    ? 'Всё прочитано.'
                    : scope === 'mine'
                      ? 'Лично для вас пока ничего. Всё по проектам — во вкладке «Все».'
                      : 'Здесь появятся приглашения, упоминания и изменения ваших задач.'}
                </p>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
