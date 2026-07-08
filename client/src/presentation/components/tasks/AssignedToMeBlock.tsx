import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CalendarOff,
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
import type { Task, RalphMode, TaskPriority } from '@/domain/task/Task';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import {
  ASSIGNED_GROUPING_LABELS,
  ASSIGNED_GROUPINGS,
  DEFAULT_ASSIGNED_GROUPING,
  type AssignedGrouping,
} from '@/domain/user/UiPrefs';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { groupAssignedByTime, groupAssignedTasks } from './assignedGrouping';
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
  // Режим отображения (как у страницы «Входящие»): 'kanban' — группы становятся колонками
  // канбана (карточки = поручения), 'list' — плоский список с заголовками групп.
  view?: 'kanban' | 'list';
  // Full-bleed классы (как у доски проекта): в kanban ряд колонок выносится за паддинг
  // страницы, чтобы отступы от краёв были такими же, как в проектах.
  bleedNegClass?: string;
  bleedPadClass?: string;
};

// Блок «Поручено мне» на главной: задачи, делегированные текущему пользователю, по всем
// проектам. Группировка переключаемая (проект/дата создания/дедлайн/приоритет) и сохраняется
// за аккаунтом (users.ui_prefs). Принятые — с чекбоксом «выполнено» (снятие галочки возвращает
// прежний статус); ожидающие — с кнопками «Принять/Отклонить». Клик по принятой задаче
// открывает её в TaskDrawer (read-access для inbox-делегата гейтится на сервере).
export function AssignedToMeBlock({
  onChanged,
  view = 'list',
  bleedNegClass = '',
  bleedPadClass = '',
}: Props): React.ReactElement | null {
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

  // Группировку (проект/дата/дедлайн/приоритет) для СПИСКА делает чистый хелпер.
  const groups = useMemo(() => groupAssignedTasks(tasks, grouping, new Date()), [tasks, grouping]);
  // Канбан «Поручено мне» — всегда РОВНО 3 колонки по времени (Без срока / На сегодня /
  // Будущее), независимо от выбранной группировки. Колонки всегда все три, даже пустые.
  const kanbanGroups = useMemo(() => groupAssignedByTime(tasks, new Date()), [tasks]);

  if (loading) return null;
  const total = tasks.length;
  if (total === 0) return null;
  const pendingCount = tasks.filter((t) => t.delegation.status === 'pending').length;
  // Русская плюрализация: 1/21/31 «ждёт ответа», иначе «ждут ответа» (11 — исключение).
  const pendingWord =
    pendingCount % 10 === 1 && pendingCount % 100 !== 11 ? 'ждёт ответа' : 'ждут ответа';

  return (
    // Персональная зона, Notion-стиль: НЕ карточка-в-рамке (рамка враждует с full-bleed
    // канбана). «Это моё» несут три тихих сигнала: identity-шапка (свой аватар + настоящий
    // заголовок + синяя count-пилюля + подзаголовок-контракт), шёпот-тинт primary на
    // колонках канбана и hairline-линейка, замыкающая зону перед основной доской.
    <section id="assigned-to-me" className="space-y-3">
      <div className="flex items-start justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* size-8 сознательно крупнее аватаров делегаторов в строках/карточках (size-6/7) —
              иерархия масштабом: это владелец зоны, а не участник треда. */}
          <UserAvatar
            displayName={user?.displayName ?? ''}
            avatarUrl={user?.avatarUrl}
            className="size-8 text-[11px]"
          />
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold leading-tight tracking-tight text-foreground">
              <span className="truncate">Поручено мне</span>
              <span className="inline-flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-medium leading-none tabular-nums text-primary">
                {total}
              </span>
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Задачи от других участников
              {pendingCount > 0 && ` · ${pendingCount} ${pendingWord}`}
            </p>
          </div>
        </div>
        {/* Группировка — только для списка. В канбане колонки фиксированы по времени, поэтому
            выпадашка не нужна. items-start прижимает её к строке заголовка. */}
        {view === 'list' && <GroupingMenu value={grouping} onChange={handleGroupingChange} />}
      </div>

      {view === 'kanban' ? (
        // Канбан: РОВНО 3 колонки по времени (Без срока / На сегодня / Будущее), карточки =
        // поручения. Ряд колонок full-bleed'ится за паддинг страницы (как доска проекта).
        <div className={cn('flex snap-x gap-3 overflow-x-auto pb-2', bleedNegClass, bleedPadClass)}>
          {kanbanGroups.map((group) => (
            <div
              key={group.key}
              // Шёпот-тинт primary вместо серого muted — колонки читаются «чуть голубыми»
              // на фоне серых колонок доски ниже. На мобиле альфа выше (зеркало паттерна
              // /60→/30), в dark ещё выше — primary тонет на графите. Не поднимать выше
              // /[0.09]//[0.11] — начинает «светиться».
              className="flex w-[86vw] max-w-[22rem] shrink-0 snap-start flex-col rounded-xl bg-primary/[0.06] dark:bg-primary/[0.09] sm:w-72 sm:max-w-none sm:bg-primary/[0.04] sm:dark:bg-primary/[0.07]"
            >
              <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2.5 text-xs font-medium text-muted-foreground">
                <TimeBucketIcon bucket={group.key} />
                <span className="min-w-0 truncate">{group.label}</span>
                <span className="shrink-0 text-muted-foreground/60">{group.items.length}</span>
              </div>
              <div className="flex min-h-[3rem] flex-col gap-2 px-2 pb-2">
                {group.items.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground/45">Пусто</p>
                ) : (
                  group.items.map((item) =>
                    item.delegation.status === 'pending' ? (
                      <PendingCard
                        key={item.delegation.id}
                        item={item}
                        busy={resolvingIds.has(item.delegation.id)}
                        onAccept={() => void resolve(item.delegation.id, 'accept')}
                        onDecline={() => void resolve(item.delegation.id, 'decline')}
                      />
                    ) : (
                      <AcceptedCard
                        key={item.delegation.id}
                        item={item}
                        currentUserId={user?.id ?? null}
                        onOpen={() => setDrawerTask(item)}
                        onChanged={handleToggled}
                      />
                    ),
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.key} className="space-y-1.5">
              <div className="flex items-center gap-1.5 px-0.5 pb-0.5 text-xs font-medium text-muted-foreground">
                <GroupIcon mode={grouping} isInbox={group.isInbox} />
                <span className="truncate">{group.label}</span>
                <span className="text-muted-foreground/60">· {group.items.length}</span>
              </div>
              <ul className="divide-y divide-border/60">
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
      )}

      {/* Hairline-линейка замыкает персональную зону перед основной доской. В канбане
          уезжает full-bleed теми же отрицательными маржинами, что и ряд колонок (в list
          bleedNegClass = '' — линия в ширину читаемой колонки). !mt-* перебивает space-y-3
          секции: линии нужно больше воздуха сверху, чем шагу шапка→тело. */}
      <div
        aria-hidden
        className={cn(
          '!mt-5 mb-1 border-t border-border sm:!mt-6 sm:mb-2',
          view === 'kanban' && bleedNegClass,
        )}
      />

      <TaskDrawer
        state={drawerTask ? ({ mode: 'edit', task: drawerTask } as TaskDrawerState) : null}
        onClose={() => {
          setDrawerTask(null);
          void refresh();
        }}
        onSubmit={handleDrawerSubmit}
        onCommitsChange={() => void refresh()}
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
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
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

// Иконка колонки канбана «Поручено мне» по времени: без срока / на сегодня / будущее.
function TimeBucketIcon({ bucket }: { bucket: string }): React.ReactElement {
  if (bucket === 'none') return <CalendarOff className="size-3.5 shrink-0" />;
  if (bucket === 'future') return <CalendarDays className="size-3.5 shrink-0" />;
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
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-3 transition-colors hover:bg-hover',
        // Done-строка: мягкая зелёная заливка (НЕ серый/НЕ opacity), как в TaskListView/
        // KanbanCard — спокойный Notion-маркер готовности; текст остаётся полноцветным.
        isDone && 'bg-success/[0.08] hover:bg-success/[0.12]',
      )}
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
          // Done-текст остаётся полноцветным (Notion: готовая задача не «гасится»).
          <ExpandableMarkdown>
            {item.description}
          </ExpandableMarkdown>
        ) : (
          <p className="text-sm leading-snug text-muted-foreground">—</p>
        )}
        <AssignedMetaBadges item={item} currentUserId={currentUserId} />
      </div>
    </li>
  );
}

// Кластер мета-бейджей поручения (делегирование, коммиты/вложения/комменты, режим, приоритет,
// дедлайн) — общий для строки списка (AcceptedRow) и карточки канбана (AcceptedCard).
function AssignedMetaBadges({
  item,
  currentUserId,
}: {
  item: AssignedTask;
  currentUserId: string | null;
}): React.ReactElement {
  return (
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
    </div>
  );
}

// === Карточки канбана (колонка = группа) ===
// Принятая задача-карточка: чекбокс «выполнено» + описание + мета-бейджи, клик открывает drawer.
function AcceptedCard({
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
    <div
      className={cn(
        'group relative flex cursor-pointer items-start gap-1.5 rounded-lg border border-black/[0.06] bg-card px-2 py-1.5 shadow-sm transition-[box-shadow,border-color,background-color] duration-150 hover:shadow-md dark:border-white/[0.08]',
        isDone && 'border-success/20 bg-success/[0.06] hover:border-success/30 hover:bg-success/[0.1]',
      )}
      onClick={onOpen}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <InboxCheckbox
          task={item}
          lastDoneTaskId={null}
          lastTodoTaskId={null}
          onChanged={onChanged}
          disabled={!item.canModify}
          disabledTitle="Вы больше не редактор этого проекта"
        />
      </div>
      <div className="min-w-0 flex-1">
        {item.description?.trim() ? (
          <ExpandableMarkdown>{item.description}</ExpandableMarkdown>
        ) : (
          <p className="text-sm leading-snug text-muted-foreground">—</p>
        )}
        <AssignedMetaBadges item={item} currentUserId={currentUserId} />
      </div>
    </div>
  );
}

// Ожидающая задача-карточка: «<аватар> Имя поручил вам», описание, кнопки Принять/Отклонить.
function PendingCard({
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
    <div className="flex flex-col gap-2.5 rounded-lg border border-l-2 border-black/[0.06] border-l-primary/40 bg-card px-2.5 py-2 shadow-sm dark:border-white/[0.08] dark:border-l-primary/40">
      <div className="flex items-start gap-2">
        <Avatar className="size-6 shrink-0">
          <AvatarFallback className={cn('text-[9px]', avatarColor(item.delegation.creatorDisplayName))}>
            {getInitials(item.delegation.creatorDisplayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug">
            <span className="font-medium">{item.delegation.creatorDisplayName}</span> поручил вам:
          </p>
          <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
            «{item.description || '(без описания)'}»
          </p>
        </div>
      </div>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-7 flex-1 gap-1 bg-success text-white hover:bg-success/90"
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
    </div>
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
    // Вертикально: сверху «<аватар> Имя поручил вам: «описание»», снизу — кнопки.
    // Так на узких экранах ничего не сжимается и кнопки ложатся ровно под текстом.
    // Тонкая акцент-полоска слева маркирует «ожидает ответа», но спокойно (без насыщенной заливки).
    <li className="flex flex-col gap-3 rounded-md border-l-2 border-primary/40 bg-hover/60 px-3 py-3">
      <div className="flex items-start gap-2.5">
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
      </div>
      {/* Кнопки под текстом, с отступом слева под аватар (size-7 + gap-2.5 = 2.375rem). */}
      <div className="flex gap-1.5 pl-[2.375rem]">
        <Button
          size="sm"
          className="h-7 gap-1 bg-success text-white hover:bg-success/90"
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
