import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import { motion } from 'motion/react';
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Bot,
  CalendarClock,
  ChevronDown,
  Flag,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { TASK_STATUSES, TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useContainer } from '@/infrastructure/di/container';
import { ConfettiBurst } from './ConfettiBurst';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { SyncedStickyScrollbar } from './SyncedStickyScrollbar';
import { SidebarResizingContext, useSidebarResizing } from '@/presentation/layout/sidebarResizingContext';
import { stashComposerDraft } from './composerDraft';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useBulkTaskActions } from '@/presentation/hooks/useBulkTaskActions';
import { useDoneSortOrder, type DoneSortOrder } from '@/presentation/hooks/useDoneSortOrder';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { LIVE_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { KanbanColumnMenu } from './KanbanColumnMenu';
import { WorkerLockOffer } from './WorkerLockOffer';
import { useUsage } from '@/presentation/usage/UsageProvider';
import { useUpgradeDialog } from '@/presentation/usage/UpgradeDialogProvider';
import { isFree } from '@/domain/usage/Usage';
import { BulkActionBar } from './BulkActionBar';
import {
  nextAnchor,
  nextSelection,
  selectAll,
  selectNone,
  type SelectModifiers,
} from './selection/selectionReducer';
import { KanbanHiddenColumnsMenu } from './KanbanHiddenColumnsMenu';
import { KANBAN_COLOR_CLASSES } from './kanbanColors';
import { QuickAddTodo } from './QuickAddTodo';
import { STATUS_LABEL, quickPromoteNext } from './statusLabels';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';
import { useKanbanSettings } from '@/presentation/hooks/useKanbanSettings';
import {
  VISIBLE_KANBAN_STATUSES,
  isColumnHidden,
  resolveColumnColor,
  resolveColumnLabel,
  type VisibleKanbanStatus,
} from '@/domain/kanban/KanbanSettings';

type Props = {
  projectId: string;
  // Если false — TaskDrawer не показывает секцию коммитов. Для inbox-проекта так:
  // у него нет git-репо, привязывать нечего.
  showCommits?: boolean;
  // Имя проекта — пробрасывается в TaskDrawer как контекстный заголовок. В inbox не передаём.
  projectName?: string;
  // Скрыть выполненные (status='done'). Toggle на странице InboxPage.
  hideDone?: boolean;
  // Количество участников проекта. > 1 ⇒ совместный — показываем блок делегирования.
  memberCount?: number;
  // Открыть диалог «Автоматизация» (кнопка в пустом состоянии доски). Передаёт TasksPage.
  onOpenAutomation?: () => void;
  // Full-bleed доски (Notion-style): отрицательные margin'ы, выносящие ряд колонок и
  // закреплённый горизонтальный скролл во всю ширину окна (в край обложки/плашки), и
  // левый padding, задающий начальный отступ первой колонки (который «уезжает» при скролле).
  // Значения зависят от паддинга страницы, поэтому передаются снаружи. По умолчанию — без bleed.
  bleedNegClass?: string;
  bleedPadClass?: string;
};

// Локальная ISO-дата 'YYYY-MM-DD' (без UTC-сдвига) — для сравнения с deadline.
function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Тихий dropdown-фильтр доски: иконка + текущий лейбл; активное состояние подсвечено.
function FilterDropdown({
  icon,
  label,
  active,
  options,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  options: ReadonlyArray<{ key: string; label: string; dotClass?: string }>;
  onSelect: (key: string) => void;
}): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cnFilterTrigger(active)}
        >
          {icon}
          {label}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {options.map((o) => (
          <DropdownMenuItem key={o.key} onClick={() => onSelect(o.key)} className="gap-2">
            {o.dotClass && <span className={`size-2.5 rounded-full ${o.dotClass}`} aria-hidden />}
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function cnFilterTrigger(active: boolean): string {
  return [
    'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
    active
      ? 'bg-primary/10 font-medium text-primary'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
  ].join(' ');
}

// Какие колонки реально рисуем. in_progress и awaiting_clarification не имеют
// собственных колонок — задачи в этих статусах визуально живут в TODO с badge'ом
// статуса справа снизу. См. KanbanCard. 'manual' — собственная колонка между
// backlog и todo: парковка для задач, которые делает человек руками.
const VISIBLE_STATUSES: readonly TaskStatus[] = ['backlog', 'manual', 'todo', 'done'];

// Маппинг реального статуса в визуальную колонку.
function toVisibleStatus(status: TaskStatus): TaskStatus {
  if (status === 'in_progress' || status === 'awaiting_clarification') return 'todo';
  return status;
}

// Длительность drop-анимации в ms. Используется и dnd-kit'ом для position-lerp'а оверлея,
// и motion'ом для exit-анимации rotate/scale у обёртки preview — они должны быть равны.
const DROP_DURATION_MS = 320;
const DROP_EASING_BEZIER = [0.32, 0.72, 0, 1] as const; // Apple smooth-spring, без длинного хвоста

// Drop-анимация: «приземление» карточки в новый слот.
// opacity у active === стартовое значение source-card (см. KanbanCard: isDragging → opacity-30),
// затем side-effect плавно возвращает к 1.
const DROP_ANIMATION: DropAnimation = {
  duration: DROP_DURATION_MS,
  easing: `cubic-bezier(${DROP_EASING_BEZIER.join(', ')})`,
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: { opacity: '0.3' },
    },
  }),
};

// Always-measuring: dnd-kit перемеряет контейнеры при каждом drag-кадре, не только при
// стартe. Это убирает рывки когда карточки в reflow меняют свои размеры/позиции.
const MEASURING_CONFIG = {
  droppable: { strategy: MeasuringStrategy.Always },
};

function groupByStatus(tasks: Task[], doneOrder: DoneSortOrder): Record<TaskStatus, Task[]> {
  // Группируем по визуальной колонке: in_progress / awaiting_clarification визуально
  // лежат в TODO (статус на task'е сохраняется и отображается badge'ом справа снизу).
  const out: Record<TaskStatus, Task[]> = {
    backlog: [],
    manual: [],
    todo: [],
    in_progress: [],
    awaiting_clarification: [],
    done: [],
  };
  for (const t of tasks) out[toVisibleStatus(t.status)].push(t);
  for (const s of TASK_STATUSES) {
    if (s === 'done') {
      // Готовые сортируем по времени завершения (updatedAt), а не по position:
      // перенос в done обновляет updatedAt, поэтому свежевыполненная задача сама
      // встаёт наверх при 'newest'. Это развязывает порядок done с position и не
      // конфликтует с drag-математикой (она привязана к position в остальных колонках).
      const dir = doneOrder === 'newest' ? -1 : 1;
      out[s].sort((a, b) => dir * (a.updatedAt.getTime() - b.updatedAt.getTime()));
    } else {
      out[s].sort((a, b) => a.position - b.position);
    }
  }
  return out;
}

export function KanbanBoard({ projectId, showCommits = true, projectName, hideDone = false, memberCount, onOpenAutomation, bleedNegClass = '', bleedPadClass = '' }: Props): React.ReactElement {
  const { tasks, loading, error, create, update, move, remove, refetch } = useTasks(projectId);
  const { user } = useCurrentUser();
  const { projectRepository } = useContainer();
  // isInbox = это inbox-board (задаётся через showCommits=false — у inbox нет git-репо).
  // Чекбокс «выполнено» показываем на ВСЕХ досках (inbox и проекты): клик → done,
  // снятие → restore прежней колонки (status_before_done). Сервер сам гейтит право
  // (move_task=editor): viewer получит 403 + revert, как и при drag'е.
  const isInbox = !showCommits;
  const isShared = !isInbox && (memberCount ?? 0) > 1;
  // Общие (на проект) настройки доски: цвета/переименования/скрытие колонок + глобальные
  // дефолтные цвета юзера. Резолв цвета/подписи делаем на лету при рендере колонок.
  const { settings, defaults, setColor, setLabel, setHidden } = useKanbanSettings(projectId);
  // I6: на бесплатном тарифе колонка «Воркер» (todo) заперта оффером апгрейда. Админ/владелец
  // безлимитного доступа не гейтится. В inbox воркера нет — там замок не нужен.
  const { usage } = useUsage();
  const { open: openUpgrade } = useUpgradeDialog();
  const workerLocked = !isInbox && usage !== null && isFree(usage.plan) && !usage.isAdmin;
  // Перезагрузка страницы не должна закрывать открытое окно задачи. Какое окно открыто
  // (edit-<taskId> / create-<status>) держим в sessionStorage пер-проект — переживает
  // reload, чистится на закрытие. Черновик create-формы хранит сам TaskDrawer.
  const drawerStoreKey = `pf-open-drawer:${projectId}`;
  const [dialog, setDialog] = useState<TaskDrawerState | null>(() => {
    try {
      const raw = sessionStorage.getItem(drawerStoreKey);
      const d = raw ? (JSON.parse(raw) as { mode?: string; status?: string }) : null;
      // create восстанавливаем сразу (задача не нужна); edit — после загрузки списка.
      if (d?.mode === 'create' && typeof d.status === 'string') {
        return { mode: 'create', status: d.status as TaskStatus };
      }
    } catch {
      /* ignore corrupted storage */
    }
    return null;
  });
  // Гидрация: edit-окно восстанавливаем ПОСЛЕ загрузки задач (нужен объект задачи;
  // create восстановлен синхронно в useState). hydratedRef гейтит запись в storage,
  // иначе persist-эффект на маунте (dialog=null) стёр бы сохранённый edit ДО восстановления.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || loading) return;
    hydratedRef.current = true;
    if (dialog) return; // create уже восстановлен синхронно
    try {
      const raw = sessionStorage.getItem(drawerStoreKey);
      const d = raw ? (JSON.parse(raw) as { mode?: string; taskId?: string }) : null;
      if (d?.mode === 'edit' && d.taskId) {
        const t = tasks.find((x) => x.id === d.taskId);
        if (t) setDialog({ mode: 'edit', task: t });
      }
    } catch {
      /* ignore */
    }
  }, [loading, tasks, dialog, drawerStoreKey]);
  // Зеркалим открытое окно в sessionStorage — только ПОСЛЕ гидрации.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (!dialog) sessionStorage.removeItem(drawerStoreKey);
      else if (dialog.mode === 'edit') {
        sessionStorage.setItem(drawerStoreKey, JSON.stringify({ mode: 'edit', taskId: dialog.task.id }));
      } else {
        sessionStorage.setItem(drawerStoreKey, JSON.stringify({ mode: 'create', status: dialog.status }));
      }
    } catch {
      /* ignore */
    }
  }, [dialog, drawerStoreKey]);
  // Цель удаления для стильного диалога подтверждения (вместо window.confirm).
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Прокручиваемый контейнер доски — для закреплённого снизу горизонтального скролла.
  const boardScrollRef = useRef<HTMLDivElement>(null);
  // ЛЮБОЙ ресайз ширины доски (тяга сайдбара/правого окна, сворачивание панели, ресайз окна)
  // → на время реколонки выключаем layout-анимацию карточек (иначе «плывут»/«висят в воздухе»,
  // особенно заметно на macOS). Сигнал true во время изменений + 160мс после последнего.
  const parentResizing = useSidebarResizing();
  const [boardResizing, setBoardResizing] = useState(false);
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let t: number | undefined;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      } // пропускаем первичное измерение при монтировании
      setBoardResizing(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setBoardResizing(false), 160);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  // Единый открытый inline-композер на все колонки (состояние поднято из колонки):
  // открыть в другой колонке → прошлый закрывается (со stash). Переживает перезагрузку
  // (sessionStorage пер-проект). Закрывается при открытии окна задачи/создания.
  const composerKey = useCallback((s: TaskStatus) => `pf:quick-add:${projectId}:${s}`, [projectId]);
  const composingStoreKey = `pf:composing:${projectId}`;
  const [composingStatus, setComposingStatus] = useState<TaskStatus | null>(() => {
    try {
      const v = sessionStorage.getItem(composingStoreKey);
      return v && (TASK_STATUSES as readonly string[]).includes(v) ? (v as TaskStatus) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (composingStatus) sessionStorage.setItem(composingStoreKey, composingStatus);
      else sessionStorage.removeItem(composingStoreKey);
    } catch {
      /* ignore */
    }
  }, [composingStatus, composingStoreKey]);
  const openComposer = useCallback(
    (s: TaskStatus) => {
      setComposingStatus((prev) => {
        if (prev && prev !== s) stashComposerDraft(composerKey(prev));
        return s;
      });
    },
    [composerKey],
  );
  const closeComposer = useCallback(() => {
    setComposingStatus((prev) => {
      if (prev) stashComposerDraft(composerKey(prev));
      return null;
    });
  }, [composerKey]);
  // Открытие окна задачи/создания (drawer) закрывает inline-композер.
  useEffect(() => {
    if (dialog) closeComposer();
  }, [dialog, closeComposer]);
  // Открытие глобального «Добавить задачу» (левая панель) шлёт событие — тоже закрываем.
  useEffect(() => {
    const onClose = (): void => closeComposer();
    window.addEventListener('pf:close-inline-composer', onClose);
    return () => window.removeEventListener('pf:close-inline-composer', onClose);
  }, [closeComposer]);

  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-link: ?task=<id> открывает диалог задачи. Используется email-кнопками И блоком
  // «Недавнее» в сайдбаре. Трекаем последний обработанный taskId (а не one-shot-флаг):
  // клик по другой записи «Недавнего» на уже смонтированной доске меняет только query
  // (доска не перемонтируется) — реагируем на смену значения. Сброс ref при пустом query
  // позволяет переоткрыть ту же задачу повторным кликом.
  const deepLinkedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const taskId = searchParams.get('task');
    if (!taskId) {
      deepLinkedTaskRef.current = null;
      return;
    }
    if (deepLinkedTaskRef.current === taskId) return;
    deepLinkedTaskRef.current = taskId;
    const task = tasks.find((t) => t.id === taskId);
    // Ловим #comment-<id> из hash ДО очистки query (setSearchParams сбрасывает hash).
    const hashMatch = /^#comment-(.+)$/.exec(window.location.hash);
    const scrollToCommentId = hashMatch ? hashMatch[1] : undefined;
    // ?done=1 — «✓ Готово»-ссылка из дайджеста: переносим задачу в «Готово».
    // С подтверждением: защита от случайного клика и префетча почтовых сканеров
    // (действие идёт в уже авторизованной сессии, право write_project гейтит сервер).
    if (task && searchParams.get('done') === '1') {
      if (window.confirm('Перенести задачу в «Готово»?')) {
        void move(task.id, { targetStatus: 'done', beforeTaskId: null, afterTaskId: null })
          .then(() => toast.success('Задача перенесена в «Готово»'))
          .catch((err) => toast.error(`Не удалось: ${(err as Error).message}`));
      }
    } else if (task) {
      setDialog({ mode: 'edit', task, scrollToCommentId });
    }
    // Чистим query, чтобы повторное открытие/refetch не дёргали диалог/перенос.
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    next.delete('done');
    setSearchParams(next, { replace: true });
  }, [loading, tasks, searchParams, setSearchParams, move]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Множество taskId с активной (running) LIVE-сессией — для 🔴 точки на карточке.
  // Обновляется по realtime-событию 'pf:live-changed' (debounce 100мс коалесцирует пачку).
  const [liveTaskIds, setLiveTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Накапливаем дельты и применяем разом (debounce), чтобы пачка start/finish не дёргала рендер.
    const pending = new Map<string, boolean>();
    const flush = (): void => {
      timer = null;
      if (pending.size === 0) return;
      setLiveTaskIds((prev) => {
        const next = new Set(prev);
        for (const [taskId, running] of pending) {
          if (running) next.add(taskId);
          else next.delete(taskId);
        }
        pending.clear();
        return next;
      });
    };
    const onLive = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string; taskId?: string; status?: string }>)
        .detail;
      if (detail?.projectId !== projectId || !detail.taskId) return;
      pending.set(detail.taskId, detail.status === 'running');
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 100);
    };
    window.addEventListener(LIVE_CHANGED_EVENT, onLive);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(LIVE_CHANGED_EVENT, onLive);
    };
  }, [projectId]);
  // Позиция drop-индикатора: в какой колонке и над каким элементом находится курсор.
  // overId — id задачи (вставка перед ней) или 'column-{status}' (вставка в конец).
  const [dropTarget, setDropTarget] = useState<{
    status: TaskStatus;
    overId: string;
  } | null>(null);
  // 'lifted' — карточка приподнята (rotate+scale), 'settled' — лерпит обратно к identity.
  // Меняем на 'settled' в момент drop'а и держим activeId до конца drop-анимации, чтобы
  // motion успел синхронно с position-lerp'ом dnd-kit'а распрямить наклон.
  const [previewPhase, setPreviewPhase] = useState<'lifted' | 'settled'>('settled');
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Мышь — drag почти мгновенный (порог 8px). Тач — drag только после удержания ~220мс
  // (long-press): обычный скролл колонок/доски пальцем больше не «хватает» карточку.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const { order: doneOrder, toggle: toggleDoneOrder } = useDoneSortOrder();
  const grouped = useMemo(() => groupByStatus(tasks, doneOrder), [tasks, doneOrder]);
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  // === Фильтры доски (клиентские, поверх grouped — drag-математика остаётся на полном списке) ===
  const [filterQuery, setFilterQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | null>(null);
  const [filterDeadline, setFilterDeadline] = useState<'overdue' | 'week' | null>(null);
  const [filterDelegate, setFilterDelegate] = useState<string | null>(null);
  // Участники — для фильтра по делегату (только совместные проекты).
  const [members, setMembers] = useState<ProjectMember[]>([]);
  useEffect(() => {
    if (!isShared) return;
    let cancelled = false;
    void projectRepository
      .listMembers(projectId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isShared, projectId, projectRepository]);

  const filterActive =
    filterQuery.trim().length > 0 ||
    filterPriority !== null ||
    filterDeadline !== null ||
    filterDelegate !== null;

  const filterTasks = useCallback(
    (list: Task[]): Task[] => {
      if (!filterActive) return list;
      const q = filterQuery.trim().toLocaleLowerCase('ru');
      const todayIso = localIsoDate(new Date());
      const weekIso = localIsoDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      return list.filter((t) => {
        if (q && !(t.description ?? '').toLocaleLowerCase('ru').includes(q)) return false;
        if (filterPriority !== null && t.priority !== filterPriority) return false;
        if (filterDeadline === 'overdue') {
          if (!t.deadline || t.deadline >= todayIso || t.status === 'done') return false;
        } else if (filterDeadline === 'week') {
          if (!t.deadline || t.deadline > weekIso) return false;
        }
        if (filterDelegate !== null && t.delegation?.delegateUserId !== filterDelegate) return false;
        return true;
      });
    },
    [filterActive, filterQuery, filterPriority, filterDeadline, filterDelegate],
  );

  const resetFilters = (): void => {
    setFilterQuery('');
    setFilterPriority(null);
    setFilterDeadline(null);
    setFilterDelegate(null);
  };

  // Конфетти при переносе карточки в «Готово» (key перезапускает анимацию).
  const [confettiKey, setConfettiKey] = useState(0);

  // === Мультивыделение (scoped к одной колонке) ===
  // selectionStatus — колонка в режиме выделения (null = режим выключен).
  const [selectionStatus, setSelectionStatus] = useState<VisibleKanbanStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null); // якорь для Shift-диапазона
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });
  // Визуальный порядок карточек активной колонки — для диапазона и «выделить всё».
  // Должен совпадать с тем, что реально отрисовано: при hideDone done-колонка пуста.
  const selectionOrderedIds =
    selectionStatus && !(hideDone && selectionStatus === 'done')
      ? grouped[selectionStatus].map((t) => t.id)
      : [];

  const enterSelection = (status: VisibleKanbanStatus): void => {
    setSelectionStatus(status);
    setSelectedIds(new Set());
    anchorRef.current = null;
  };
  const exitSelection = useCallback((): void => {
    setSelectionStatus(null);
    setSelectedIds(new Set());
    anchorRef.current = null;
  }, []);
  const handleSelectToggle = (taskId: string, mods: SelectModifiers): void => {
    // Валидируем якорь: после bulk-операций / внешних (SSE) изменений он мог указывать
    // на исчезнувшую карточку — тогда трактуем как «нет якоря» и начинаем диапазон
    // заново от кликнутой (иначе Shift молча деградировал бы в одиночный тогл навсегда).
    const anchor =
      anchorRef.current && selectionOrderedIds.includes(anchorRef.current)
        ? anchorRef.current
        : null;
    setSelectedIds((prev) => nextSelection(prev, taskId, mods, selectionOrderedIds, anchor));
    anchorRef.current = nextAnchor(taskId, mods, anchor);
  };
  const handleSelectAll = (): void => {
    setSelectedIds(selectAll(selectionOrderedIds));
    anchorRef.current = null;
  };
  const handleSelectNone = (): void => {
    setSelectedIds(selectNone());
    anchorRef.current = null;
  };

  // Esc выходит из режима выделения (слушаем только пока режим активен).
  // defaultPrevented пропускаем: открытый Radix-дропдаун/диалог уже обработал Esc
  // (закрылся) и вызвал preventDefault — не хотим заодно гасить весь режим.
  useEffect(() => {
    if (selectionStatus === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) exitSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionStatus, exitSelection]);

  // hideDone скрывает done-колонку целиком — выходим из выделения, чтобы не оставлять
  // «подвисший» режим (счётчик и кнопки) на пустой невидимой колонке.
  useEffect(() => {
    if (hideDone && selectionStatus === 'done') exitSelection();
  }, [hideDone, selectionStatus, exitSelection]);
  // Последняя задача в backlog/todo — нужна footer-композеру в TaskDrawer'е для
  // beforeTaskId при move'е через переключатель «В черновики / Воркеру».
  const backlogTail = grouped.backlog[grouped.backlog.length - 1] ?? null;
  const todoTail = grouped.todo[grouped.todo.length - 1] ?? null;
  // Inbox-чекбокс: при ткании «done» кладём в конец done-колонки; «un-done» — в конец todo.
  // doneOrder влияет на отображение (newest сверху/снизу), но «последний по position»
  // — это для расчёта позиции на сервере; используем хвост по position среди done.
  const doneByPos = useMemo(() => [...tasks.filter((t) => t.status === 'done')].sort((a, b) => a.position - b.position), [tasks]);
  const lastDoneTaskId = doneByPos[doneByPos.length - 1]?.id ?? null;
  const lastTodoTaskId = todoTail?.id ?? null;

  const handleDragStart = (e: DragStartEvent): void => {
    // Если drop-таймер ещё висит от предыдущего перетаскивания — гасим, иначе он позже
    // обнулит activeId уже нового drag'а.
    if (dropTimerRef.current) {
      clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    setActiveId(String(e.active.id));
    setDropTarget(null);
    setPreviewPhase('lifted');
  };

  const handleDragOver = (e: DragOverEvent): void => {
    const { active, over } = e;
    if (!over || !active) {
      setDropTarget(null);
      return;
    }

    const overData = over.data.current as
      | { type?: 'task' | 'column'; status?: TaskStatus }
      | undefined;

    if (overData?.type === 'column' && overData.status) {
      setDropTarget({ status: overData.status, overId: `column-${overData.status}` });
    } else if (overData?.type === 'task') {
      const overTask = tasks.find((t) => t.id === over.id);
      if (!overTask) {
        setDropTarget(null);
        return;
      }
      setDropTarget({
        status: toVisibleStatus(overTask.status),
        overId: String(over.id),
      });
    } else {
      setDropTarget(null);
    }
  };

  const handleDragEnd = async (e: DragEndEvent): Promise<void> => {
    // 1) motion начинает лерпить rotate/scale обратно к identity.
    setPreviewPhase('settled');
    setDropTarget(null);
    // 2) activeId держим живым ровно до конца drop-анимации — DragOverlay в это время
    //    рендерит motion.div, и тот успевает доехать до rotate:0.
    dropTimerRef.current = setTimeout(() => {
      setActiveId(null);
      dropTimerRef.current = null;
    }, DROP_DURATION_MS);
    const { active, over } = e;
    if (!over) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    // Определяем целевой статус: либо это column drop zone, либо карточка из колонки.
    const overData = over.data.current as { type?: 'task' | 'column'; status?: TaskStatus } | undefined;
    let targetStatus: TaskStatus;
    if (overData?.type === 'column' && overData.status) {
      targetStatus = overData.status;
    } else {
      const overTask = tasks.find((t) => t.id === over.id);
      if (!overTask) return;
      // Visible-нормализация: если дропнули над in_progress/awaiting_clarification
      // карточкой (визуально лежит в TODO), целевая колонка — todo.
      targetStatus = toVisibleStatus(overTask.status);
    }

    // Если активная задача in_progress / awaiting_clarification дропается в TODO
    // (где она и так живёт визуально), её реальный статус сохраняем — это просто
    // реордер внутри визуальной колонки, а не возврат к todo.
    if (
      targetStatus === 'todo' &&
      (activeTask.status === 'in_progress' || activeTask.status === 'awaiting_clarification')
    ) {
      targetStatus = activeTask.status;
    }

    // Список карточек в визуальной колонке БЕЗ перетаскиваемой (для расчёта соседей).
    // Берём именно визуальную колонку, потому что in_progress / awaiting_clarification
    // карточки физически живут в grouped['todo'] (см. groupByStatus).
    const visibleColumn = toVisibleStatus(targetStatus);
    const targetList = grouped[visibleColumn].filter((t) => t.id !== activeTask.id);

    let insertIndex: number;
    if (overData?.type === 'column') {
      // Кинули в пустое место колонки — в конец.
      insertIndex = targetList.length;
    } else {
      insertIndex = targetList.findIndex((t) => t.id === over.id);
      if (insertIndex === -1) insertIndex = targetList.length;
    }

    const beforeTask = insertIndex > 0 ? targetList[insertIndex - 1] : null;
    const afterTask = insertIndex < targetList.length ? targetList[insertIndex] : null;

    // Реордер ВНУТРИ «Готово» бессмысленен: колонка сортируется по updatedAt (см.
    // groupByStatus), а не по position. Любой move лишь обновил бы updatedAt — и
    // задача прыгнула бы наверх, «как будто её редактировали». Случайно вытащил и
    // вернул в done → просто игнорируем, карточка остаётся на месте.
    if (visibleColumn === 'done' && activeTask.status === 'done') return;

    // No-op: дропнули туда же, где было.
    if (toVisibleStatus(activeTask.status) === visibleColumn) {
      const currentList = grouped[visibleColumn];
      const currentIndex = currentList.findIndex((t) => t.id === activeTask.id);
      if (currentIndex === insertIndex || currentIndex === insertIndex - 1) return;
    }

    try {
      await move(activeTask.id, {
        targetStatus,
        beforeTaskId: beforeTask?.id ?? null,
        afterTaskId: afterTask?.id ?? null,
      });
      // Микро-праздник: дотащили в «Готово» (не реордер внутри done).
      if (targetStatus === 'done' && activeTask.status !== 'done') {
        setConfettiKey((k) => k + 1);
      }
    } catch (err) {
      toast.error(`Не удалось переместить: ${(err as Error).message}`);
    }
  };

  const handleDialogSubmit = async (input: {
    description: string;
    ralphMode?: import('@/domain/task/Task').RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: import('@/domain/task/Task').TaskPriority | null;
  }): Promise<Task> => {
    if (!dialog) throw new Error('Dialog state missing');
    if (dialog.mode === 'create') {
      return create({ ...input, status: dialog.status });
    }
    // edit-mode: TaskRepository.update не принимает delegateUserId — он только
    // для create. Deadline/priority меняются через TaskPriorityChip/TaskDeadlineChip
    // в шапке drawer'а (отдельные PATCH).
    return update(dialog.task.id, { description: input.description, ralphMode: input.ralphMode });
  };

  // Якорь вставки в НАЧАЛО целевой колонки: колонки обрезаны порцией «первых 4 +
  // Показать ещё», и вставка в конец (null/null → bounds.max) прятала бы карточку в
  // скрытом хвосте — «задача пропала». afterTaskId = первая карточка → встаём над ней.
  // «Готово» сортируется по updatedAt — свежеперенесённая всплывает сама, позицию не трогаем.
  const topAnchorFor = (status: TaskStatus): string | null =>
    status === 'done' ? null : (grouped[status][0]?.id ?? null);

  const handleQuickPromote = async (task: Task): Promise<void> => {
    // «Шаг вперёд» по колонкам: Черновики→Вручную→Воркер→Готово (quickPromoteNext).
    const next = quickPromoteNext(task.status);
    if (!next) return;
    try {
      await move(task.id, { targetStatus: next, beforeTaskId: null, afterTaskId: topAnchorFor(next) });
      toast.success(`Передано: ${STATUS_LABEL[next]}`);
    } catch (err) {
      toast.error(`Не удалось перенести: ${(err as Error).message}`);
    }
  };

  // Удаление через стильный диалог (не нативный confirm): handleDelete лишь открывает
  // окно, реальное удаление — в confirmDelete по кнопке «Удалить».
  const handleDelete = (task: Task): void => {
    setDeleteTarget(task);
  };
  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      toast.success('Задача удалена');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(`Не удалось удалить: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="flex gap-3 overflow-x-auto">
          {VISIBLE_STATUSES.map((s) => (
            <div
              key={s}
              className="h-64 w-[82vw] max-w-[20rem] shrink-0 animate-pulse rounded-xl bg-muted/60 sm:w-72 sm:max-w-none sm:bg-muted"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  // Скрытые колонки исключаем из рендера (задачи скрытых статусов остаются в `grouped`,
  // поэтому drag-математика в handleDragEnd не ломается). Скрытые перечисляем в меню доски.
  const shownStatuses = VISIBLE_KANBAN_STATUSES.filter((s) => !isColumnHidden(settings?.[s]));
  const hiddenColumns = VISIBLE_KANBAN_STATUSES.filter((s) => isColumnHidden(settings?.[s])).map(
    (s) => ({ status: s, label: resolveColumnLabel(settings?.[s], STATUS_LABEL[s]) }),
  );

  // Пред/след задача для навигации в окне: соседи в той же колонке (в порядке отображения).
  const drawerSiblings = dialog?.mode === 'edit' ? grouped[dialog.task.status] ?? [] : [];
  const drawerIdx =
    dialog?.mode === 'edit' ? drawerSiblings.findIndex((t) => t.id === dialog.task.id) : -1;
  const drawerPrev = drawerIdx > 0 ? drawerSiblings[drawerIdx - 1] : null;
  const drawerNext =
    drawerIdx >= 0 && drawerIdx < drawerSiblings.length - 1 ? drawerSiblings[drawerIdx + 1] : null;

  return (
    // Single-scroll (Notion): доска НЕ ограничена высотой экрана и НЕ скроллится внутри себя —
    // растёт по контенту, а скроллится вся страница (родительский <main overflow-y-auto>).
    // Провайдер «идёт ресайз» = тяга сайдбара ИЛИ реколонка доски по любой причине.
    <SidebarResizingContext.Provider value={parentResizing || boardResizing}>
    {/* flex-[1_0_auto]: доска заполняет свободную высоту тела страницы при коротком контенте
        (тогда flex-1-спейсер ниже проталкивает закреплённый скролл к самому низу) И растёт по
        контенту при длинном (страница скроллится, sticky-скролл прилипает к низу вьюпорта). */}
    <div className="flex flex-[1_0_auto] flex-col">
      {confettiKey > 0 && <ConfettiBurst key={confettiKey} onDone={() => setConfettiKey(0)} />}

      {/* Тихий ряд фильтров: поиск по проекту + приоритет + срок (+ делегат в совместных). */}
      <div className="flex flex-wrap items-center gap-1 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Фильтр по тексту…"
            aria-label="Фильтр задач по тексту"
            className="h-7 w-32 rounded-md bg-transparent pl-7 pr-2 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-accent/60 focus:bg-accent/60 sm:w-44"
          />
        </div>
        <FilterDropdown
          icon={<Flag className="size-3.5" />}
          label={filterPriority !== null ? PRIORITY_META[filterPriority].label : 'Приоритет'}
          active={filterPriority !== null}
          options={[
            { key: 'all', label: 'Любой приоритет' },
            ...TASK_PRIORITIES.map((p) => ({
              key: String(p),
              label: PRIORITY_META[p].label,
              dotClass: PRIORITY_META[p].dotColor,
            })),
          ]}
          onSelect={(key) => setFilterPriority(key === 'all' ? null : (Number(key) as TaskPriority))}
        />
        <FilterDropdown
          icon={<CalendarClock className="size-3.5" />}
          label={
            filterDeadline === 'overdue'
              ? 'Просрочено'
              : filterDeadline === 'week'
                ? 'Эта неделя'
                : 'Срок'
          }
          active={filterDeadline !== null}
          options={[
            { key: 'all', label: 'Любой срок' },
            { key: 'overdue', label: 'Просрочено' },
            { key: 'week', label: 'Ближайшая неделя' },
          ]}
          onSelect={(key) => setFilterDeadline(key === 'all' ? null : (key as 'overdue' | 'week'))}
        />
        {isShared && members.length > 0 && (
          <FilterDropdown
            icon={<Users className="size-3.5" />}
            label={
              filterDelegate !== null
                ? members.find((m) => m.userId === filterDelegate)?.user.displayName ?? 'Делегат'
                : 'Делегат'
            }
            active={filterDelegate !== null}
            options={[
              { key: 'all', label: 'Все участники' },
              ...members.map((m) => ({ key: m.userId, label: m.user.displayName })),
            ]}
            onSelect={(key) => setFilterDelegate(key === 'all' ? null : key)}
          />
        )}
        {filterActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" />
            Сбросить
          </button>
        )}
      </div>

      {/* Пустой проект: дружелюбный старт вместо четырёх голых колонок. */}
      {!loading && tasks.length === 0 && !filterActive && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Проект пуст — создайте первую задачу{onOpenAutomation ? ' или включите автоматизацию' : ''}.
          </p>
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => setDialog({ mode: 'create', status: 'backlog' })}>
              <Plus className="size-3.5" />
              Создать задачу
            </Button>
            {onOpenAutomation && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground" onClick={onOpenAutomation}>
                <Bot className="size-3.5" />
                Автоматизация
              </Button>
            )}
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        measuring={MEASURING_CONFIG}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDropTarget(null);
          setPreviewPhase('settled');
          setActiveId(null);
        }}
      >
        {/* На мобиле колонки занимают почти всю ширину и «прилипают» при свайпе
            (snap), на десктопе — обычный горизонтальный ряд. Drag между колонками
            работает в обоих режимах: все колонки в DOM, просто проскроллены.
            items-start — каждая колонка своей высоты по контенту (не тянется до самой длинной);
            высота ряда = самой длинной колонки, вертикально скроллит страница целиком. */}
        <div
          ref={boardScrollRef}
          className={cn(
            // items-start + full-bleed: ряд колонок во всю ширину окна; первая колонка
            // отступает на bleedPadClass (уезжает при скролле), последняя доходит до края.
            'flex items-start snap-x snap-mandatory gap-3 overflow-x-auto pb-20 sm:snap-none sm:pb-28',
            // Родной горизонтальный скролл прячем — видимый и закреплённый снизу даёт
            // SyncedStickyScrollbar (иначе внизу доски появляется второй «раздвоенный» бар).
            '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            bleedNegClass,
            bleedPadClass,
          )}
        >
          {shownStatuses.map((status) => {
            const perColumn = settings?.[status];
            const color = resolveColumnColor(perColumn, defaults?.[status], status);
            const label = resolveColumnLabel(perColumn, STATUS_LABEL[status]);
            return (
              <KanbanColumn
                key={status}
                status={status}
                label={label}
                tasks={filterTasks(hideDone && status === 'done' ? [] : grouped[status])}
                onCreate={(s) => setDialog({ mode: 'create', status: s })}
                onEdit={(t) => setDialog({ mode: 'edit', task: t })}
                onDelete={handleDelete}
                showShortId={showCommits}
                onQuickPromote={handleQuickPromote}
                onTaskChanged={() => void refetch()}
                showCheckbox
                lastDoneTaskId={lastDoneTaskId}
                lastTodoTaskId={lastTodoTaskId}
                currentUserId={user?.id ?? null}
                activeId={activeId}
                dropTarget={dropTarget?.status === status ? dropTarget : null}
                liveTaskIds={liveTaskIds}
                colorClasses={KANBAN_COLOR_CLASSES[color]}
                onRename={label.length > 0 ? (l) => setLabel(status, l) : undefined}
                lockOffer={
                  status === 'todo' && workerLocked ? (
                    <WorkerLockOffer onUpgrade={openUpgrade} />
                  ) : undefined
                }
                onInlineCreate={(input) => create({ ...input, status: input.status ?? status })}
                isInbox={isInbox}
                isShared={isShared}
                aiProjectId={isInbox ? null : projectId}
                composerStorageKey={composerKey(status)}
                composing={composingStatus === status}
                onComposingChange={(open) => (open ? openComposer(status) : closeComposer())}
                selectionMode={selectionStatus === status}
                selectedIds={selectionStatus === status ? selectedIds : undefined}
                onSelectToggle={handleSelectToggle}
                onSelectAll={handleSelectAll}
                onSelectNone={handleSelectNone}
                onExitSelection={exitSelection}
                onEnterSelection={() => enterSelection(status)}
                columnMenu={
                  <KanbanColumnMenu
                    status={status}
                    currentColor={color}
                    currentLabel={label}
                    onColor={(c) => setColor(status, c)}
                    onLabel={(l) => setLabel(status, l)}
                    onHide={() => setHidden(status, true)}
                    onSelect={() => enterSelection(status)}
                  />
                }
                headerExtra={
                  status === 'done' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={toggleDoneOrder}
                      aria-label={
                        doneOrder === 'newest'
                          ? 'Сейчас сверху новые. Показать сначала старые'
                          : 'Сейчас сверху старые. Показать сначала новые'
                      }
                      title={doneOrder === 'newest' ? 'Сверху новые' : 'Сверху старые'}
                    >
                      {doneOrder === 'newest' ? (
                        <ArrowDownNarrowWide className="size-4" />
                      ) : (
                        <ArrowUpNarrowWide className="size-4" />
                      )}
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
          <KanbanHiddenColumnsMenu
            hidden={hiddenColumns}
            onShow={(status) => setHidden(status, false)}
          />
        </div>
        {/* Спейсер: при коротком контенте забирает свободную высоту и проталкивает
            закреплённый скролл к самому низу; при длинном — схлопывается в 0. */}
        <div className="min-h-0 flex-1" aria-hidden />
        {/* Закреплённый снизу вьюпорта горизонтальный скролл доски (см. компонент).
            bleedNegClass — во всю ширину окна (по краям обложки/плашки), как ряд колонок. */}
        <SyncedStickyScrollbar targetRef={boardScrollRef} className={bleedNegClass} />
        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeTask ? (
            // Tilt + scale живут на motion-обёртке, а не на CSS карточки — иначе оверлей
            // приземляется в позицию, но наклон ещё «висит» (CSS-трансформа запечена
            // в snapshot DragOverlay). previewPhase переключается на 'settled' в момент
            // drop'а, motion лерпит rotate/scale к identity синхронно с position-lerp'ом.
            <motion.div
              initial={false}
              animate={
                previewPhase === 'lifted'
                  ? { rotate: 2, scale: 1.04 }
                  : { rotate: 0, scale: 1 }
              }
              transition={{ duration: DROP_DURATION_MS / 1000, ease: DROP_EASING_BEZIER }}
              style={{ transformOrigin: 'center' }}
            >
              <KanbanCard
                task={activeTask}
                onEdit={() => undefined}
                onDelete={() => undefined}
                preview
                showShortId={showCommits}
              />
            </motion.div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDrawer
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
        onCommitsChange={() => void refetch()}
        projectName={projectName}
        backlogTail={backlogTail}
        todoTail={todoTail}
        isInbox={isInbox}
        isShared={isShared}
        aiProjectId={isInbox ? null : projectId}
        onPrev={drawerPrev ? () => setDialog({ mode: 'edit', task: drawerPrev }) : undefined}
        onNext={drawerNext ? () => setDialog({ mode: 'edit', task: drawerNext }) : undefined}
        onMove={async (taskId, targetStatus) => {
          await move(taskId, {
            targetStatus,
            beforeTaskId: null,
            // В начало целевой колонки — в видимую порцию (см. topAnchorFor).
            afterTaskId: topAnchorFor(targetStatus),
          });
          // Обновляем dialog-state чтобы drawer показывал новый статус сразу.
          setDialog((prev) => {
            if (prev?.mode !== 'edit' || prev.task.id !== taskId) return prev;
            return { mode: 'edit', task: { ...prev.task, status: targetStatus } };
          });
        }}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        taskLabel={
          deleteTarget
            ? (deleteTarget.description ?? '').split('\n')[0]?.slice(0, 60).trim() || null
            : null
        }
        onConfirm={() => void confirmDelete()}
        busy={deleting}
      />

      {/* Floating quick-add (position: fixed). DOM-позиция значения не имеет —
          важно лишь чтобы компонент был смонтирован. Скрываем во время выделения,
          чтобы не конкурировать с панелью массовых действий. */}
      {selectionStatus === null && (
        <QuickAddTodo
          projectId={projectId}
          isInbox={isInbox}
          isShared={isShared}
          aiProjectId={isInbox ? null : projectId}
          onCreate={(input) => create({ ...input, status: input.status ?? 'todo' })}
        />
      )}

      {/* Панель массовых действий — поверх доски, когда выбрана хотя бы одна задача. */}
      {selectionStatus !== null && selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectionOrderedIds.filter((id) => selectedIds.has(id))}
          projectId={projectId}
          isInbox={isInbox}
          currentUserId={user?.id ?? null}
          moveTargets={shownStatuses.map((s) => ({
            status: s,
            label: resolveColumnLabel(settings?.[s], STATUS_LABEL[s]),
          }))}
          bulk={bulk}
          onExit={exitSelection}
        />
      )}
    </div>
    </SidebarResizingContext.Provider>
  );
}
