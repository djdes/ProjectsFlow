import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  Flag,
  FolderKanban,
  GitCommit,
  ImageIcon,
  Inbox as InboxIcon,
  ListFilter,
  MessageSquare,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { relativeTime } from '@/lib/relativeTime';
import type { Task, RalphMode, TaskPriority } from '@/domain/task/Task';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import {
  ASSIGNED_GROUPING_LABELS,
  ASSIGNED_GROUPINGS,
  DEFAULT_ASSIGNED_GROUPING,
  type AssignedGrouping,
} from '@/domain/user/UiPrefs';
import { groupAssignedTasks } from './assignedGrouping';
import { ExpandableMarkdown } from './ExpandableMarkdown';
import { InboxCheckbox } from './InboxCheckbox';
import { DelegationBadge } from './DelegationBadge';
import { PriorityBadge } from './PriorityBadge';
import { DeadlineBadge } from './DeadlineBadge';
import { RalphModeBadge } from './RalphMode';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';

type Props = {
  // Колбэк после accept/decline/toggle — InboxPage перефетчит доску ниже (принятые
  // задачи мёрджатся в inbox-список).
  onChanged?: () => void;
};

// Блок «Поручено мне» на главной: задачи, делегированные текущему пользователю, по всем
// проектам. Группировка переключаемая (проект/дата создания/дедлайн/приоритет) и сохраняется
// за аккаунтом (users.ui_prefs). Принятые — с чекбоксом «выполнено» (снятие галочки возвращает
// прежний статус); ожидающие — с кнопками «Принять/Отклонить». Клик по принятой задаче
// открывает её в TaskDrawer (read-access для inbox-делегата гейтится на сервере).
export function AssignedToMeBlock({ onChanged }: Props): React.ReactElement | null {
  const { taskDelegationRepository, taskRepository, userRepository } = useContainer();
  const { user } = useCurrentUser();
  // refresh списка проектов: при accept сервер помечает проект задачи favorite'ом — чтобы
  // секция «Избранное» в сайдбаре сразу его подхватила, перезагружаем список после принятия.
  const { refresh: refreshProjects } = useProjectsContext();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [grouping, setGrouping] = useState<AssignedGrouping>(DEFAULT_ASSIGNED_GROUPING);
  const [loading, setLoading] = useState(true);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [drawerTask, setDrawerTask] = useState<AssignedTask | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await taskDelegationRepository.listAssignedToMe();
      setTasks(list);
    } catch (e) {
      toast.error(`Не удалось загрузить поручения: ${(e as Error).message}`);
    }
  }, [taskDelegationRepository]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Список задач + сохранённую группировку грузим вместе и гейтим первый рендер на оба —
    // блок не «мигает» дефолтной группировкой перед применением сохранённой.
    Promise.all([taskDelegationRepository.listAssignedToMe(), userRepository.getUiPrefs()])
      .then(([list, prefs]) => {
        if (cancelled) return;
        setTasks(list);
        if (prefs.inboxAssignedGrouping) setGrouping(prefs.inboxAssignedGrouping);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Не удалось загрузить поручения: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Перефетч при возврате на вкладку — ловим новые поручения без ручного refresh.
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [taskDelegationRepository, userRepository, refresh]);

  const handleGroupingChange = (next: AssignedGrouping): void => {
    // Оптимистично: группировка применяется мгновенно, сохранение летит в фоне.
    setGrouping(next);
    void userRepository.setUiPrefs({ inboxAssignedGrouping: next }).catch((e: unknown) => {
      toast.error(`Не удалось сохранить группировку: ${(e as Error).message}`);
    });
  };

  const resolve = async (delegationId: string, action: 'accept' | 'decline'): Promise<void> => {
    setResolvingIds((s) => new Set(s).add(delegationId));
    try {
      if (action === 'accept') {
        await taskDelegationRepository.accept(delegationId);
        // Сервер мог добавить проект задачи в избранное принявшего — обновляем сайдбар.
        refreshProjects();
        toast.success('Задача принята');
      } else {
        await taskDelegationRepository.decline(delegationId);
        toast.success('Задача отклонена');
      }
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setResolvingIds((s) => {
        const n = new Set(s);
        n.delete(delegationId);
        return n;
      });
    }
  };

  const handleToggled = (): void => {
    void refresh();
    onChanged?.();
  };

  const handleDrawerSubmit = async (input: {
    description: string;
    ralphMode?: RalphMode;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }): Promise<Task> => {
    if (!drawerTask) throw new Error('Нет открытой задачи');
    return taskRepository.update(drawerTask.projectId, drawerTask.id, {
      description: input.description,
      ralphMode: input.ralphMode,
    });
  };

  // Группировку (проект/дата/дедлайн/приоритет) делает чистый презентационный хелпер.
  const groups = useMemo(() => groupAssignedTasks(tasks, grouping, new Date()), [tasks, grouping]);

  if (loading) return null;
  const total = tasks.length;
  if (total === 0) return null;

  return (
    <section
      id="assigned-to-me"
      className="space-y-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3 dark:border-primary/25 dark:bg-primary/[0.06]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Поручено мне
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {total}
          </span>
        </h2>
        <GroupingMenu value={grouping} onChange={handleGroupingChange} />
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-0.5 text-xs font-medium text-muted-foreground">
              <GroupIcon mode={grouping} isInbox={group.isInbox} />
              <span className="truncate">{group.label}</span>
              <span className="text-muted-foreground/60">· {group.items.length}</span>
            </div>
            <ul className="divide-y overflow-hidden rounded-md border bg-card">
              {/* Хелпер уже отсортировал: ожидающие (pending) наверх, затем по релевантному ключу. */}
              {group.items.map((item) =>
                item.delegation.status === 'pending' ? (
                  <PendingRow
                    key={item.delegation.id}
                    item={item}
                    busy={resolvingIds.has(item.delegation.id)}
                    onAccept={() => void resolve(item.delegation.id, 'accept')}
                    onDecline={() => void resolve(item.delegation.id, 'decline')}
                  />
                ) : (
                  <AcceptedRow
                    key={item.delegation.id}
                    item={item}
                    currentUserId={user?.id ?? null}
                    onOpen={() => setDrawerTask(item)}
                    onChanged={handleToggled}
                  />
                ),
              )}
            </ul>
          </div>
        ))}
      </div>

      <TaskDrawer
        state={drawerTask ? ({ mode: 'edit', task: drawerTask } as TaskDrawerState) : null}
        onClose={() => {
          setDrawerTask(null);
          void refresh();
        }}
        onSubmit={handleDrawerSubmit}
        onCommitsChange={() => void refresh()}
        showCommits={drawerTask ? !drawerTask.isInbox : false}
        projectName={drawerTask && !drawerTask.isInbox ? drawerTask.projectName : undefined}
        isInbox={drawerTask?.isInbox ?? false}
        aiProjectId={drawerTask && !drawerTask.isInbox ? drawerTask.projectId : null}
      />
    </section>
  );
}

// Переключатель группировки. Radio-меню; текущий режим отмечен. Сохранение — в handleGroupingChange.
function GroupingMenu({
  value,
  onChange,
}: {
  value: AssignedGrouping;
  onChange: (g: AssignedGrouping) => void;
}): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Группировка"
        >
          <ListFilter className="size-3.5" />
          <span className="hidden sm:inline">Группировка:</span>
          <span className="font-medium text-foreground">{ASSIGNED_GROUPING_LABELS[value]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as AssignedGrouping)}
        >
          {ASSIGNED_GROUPINGS.map((g) => (
            <DropdownMenuRadioItem key={g} value={g}>
              {ASSIGNED_GROUPING_LABELS[g]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Иконка заголовка группы: для project — инбокс/проект; для priority — флажок; для
// created/deadline — календарь с часами.
function GroupIcon({
  mode,
  isInbox,
}: {
  mode: AssignedGrouping;
  isInbox: boolean;
}): React.ReactElement {
  if (mode === 'project') {
    return isInbox ? (
      <InboxIcon className="size-3.5 shrink-0" />
    ) : (
      <FolderKanban className="size-3.5 shrink-0" />
    );
  }
  if (mode === 'priority') return <Flag className="size-3.5 shrink-0" />;
  return <CalendarClock className="size-3.5 shrink-0" />;
}

// Принятая задача — ведёт себя как обычная строка: чекбокс «выполнено» (снятие
// восстанавливает прежний статус), клик открывает drawer.
function AcceptedRow({
  item,
  currentUserId,
  onOpen,
  onChanged,
}: {
  item: AssignedTask;
  currentUserId: string | null;
  onOpen: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const isDone = item.status === 'done';
  return (
    <li
      className="group flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/40"
      onClick={onOpen}
    >
      <InboxCheckbox
        task={item}
        lastDoneTaskId={null}
        lastTodoTaskId={null}
        onChanged={onChanged}
        disabled={!item.canModify}
        disabledTitle="Вы больше не редактор этого проекта"
      />
      <div className="min-w-0 flex-1">
        {item.description?.trim() ? (
          <ExpandableMarkdown className={cn(isDone && 'line-through opacity-60')}>
            {item.description}
          </ExpandableMarkdown>
        ) : (
          <p className="text-sm leading-snug text-muted-foreground">—</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {currentUserId && (
            <DelegationBadge delegation={item.delegation} currentUserId={currentUserId} />
          )}
          {(item.commitCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <GitCommit className="size-2.5" />
              {item.commitCount}
            </span>
          )}
          {(item.attachmentCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400">
              <ImageIcon className="size-2.5" />
              {item.attachmentCount}
            </span>
          )}
          {(item.commentCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400">
              <MessageSquare className="size-2.5" />
              {item.commentCount}
            </span>
          )}
          <RalphModeBadge mode={item.ralphMode} />
          {item.priority !== null && item.priority !== undefined && (
            <PriorityBadge priority={item.priority} />
          )}
          {item.deadline && <DeadlineBadge deadline={item.deadline} status={item.status} />}
          <span className="opacity-60" title={item.createdAt.toLocaleString('ru-RU')}>
            {relativeTime(item.createdAt)}
          </span>
        </div>
      </div>
    </li>
  );
}

// Ожидающая задача — не открывается; кнопки «Принять/Отклонить».
function PendingRow({
  item,
  busy,
  onAccept,
  onDecline,
}: {
  item: AssignedTask;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}): React.ReactElement {
  return (
    <li className="flex items-start gap-2.5 border-l-2 border-primary px-3 py-2">
      <Avatar className="size-7 shrink-0">
        <AvatarFallback
          className={cn('text-[10px]', avatarColor(item.delegation.creatorDisplayName))}
        >
          {getInitials(item.delegation.creatorDisplayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-medium">{item.delegation.creatorDisplayName}</span> поручил вам:
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          «{item.description || '(без описания)'}»
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          size="sm"
          className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700"
          disabled={busy}
          onClick={onAccept}
        >
          <Check className="size-3.5" />
          Принять
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-muted-foreground"
          disabled={busy}
          onClick={onDecline}
        >
          <X className="size-3.5" />
          Отклонить
        </Button>
      </div>
    </li>
  );
}
