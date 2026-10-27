import { selectInboxView } from './inbox/selectInboxView';
import { WorkerActivityBadge } from './WorkerActivityBadge';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import { BoardSkeleton, InboxLoadingLayout } from '@/presentation/components/loading/LoadingLayouts';
import { usePageRefresh } from '@/presentation/components/experience/usePageRefresh';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { STATUS_LABEL, canSendToWorker, canTakeToManual } from './statusLabels';
import { WORKER_HANDOFF_LABEL, WorkerHandoffIcon, useWorkerHandoffAvailable } from './workerHandoff';
import {
  applyPatches,
  settledPatchIds,
  withPatch,
  withoutPatches,
  type PatchMap,
} from './optimisticTaskPatches';
import { motion } from 'motion/react';
import {
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Check,
  ChevronRight,
  ChevronsLeft,
  Eye,
  EyeOff,
  ArrowRight,
  Filter,
  Flag,
  FolderKanban,
  GitCommit,
  GripVertical,
  ImageIcon,
  Inbox as InboxIcon,
  ListFilter,
  Loader2,
  ShieldCheck,
  MessageSquare,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { projectToneClass } from '@/lib/tone';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { useFlashExitPhase, EXIT_MS } from '@/presentation/hooks/useFlashExitPhase';
import { useExitingListItems } from '@/presentation/hooks/useExitingListItems';
import { useUnreadTasks } from '@/presentation/hooks/UnreadTasksProvider';
import { useFocusedInbox } from '@/presentation/hooks/FocusedInboxProvider';
import { getTaskCreationDeadline } from '@/domain/task/defaultTaskDeadline';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { useSpotlightTask } from '@/presentation/hooks/useSpotlightTask';
import { useInboxRealtimeRefresh } from '@/presentation/hooks/useInboxRealtimeRefresh';
import { useCtrlOrMetaHeld } from '@/presentation/hooks/useCtrlOrMetaHeld';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import type { Task, RalphMode, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import {
  ASSIGNED_GROUPING_LABELS,
  ASSIGNED_GROUPINGS,
  DEFAULT_ASSIGNED_GROUPING,
  type AssignedGrouping,
} from '@/domain/user/UiPrefs';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';
import { userLabel } from '@/domain/user/userLabel';
import type { SharedMember } from '@/application/project/ProjectRepository';
import {
  endOfMonthYmd,
  endOfWeekYmd,
  groupAssignedByTime,
  groupAssignedTasks,
  startOfDay,
  ymd,
  type AssigneeDirection,
  type DueKind,
} from './assignedGrouping';
import {
  DueFilterChips,
  ReplyFilterChip,
  InboxSearch,
  InboxSectionSwitch,
  ManualIcon,
  QueueHeader,
  SwipeToAct,
  type InboxSection,
  type SwipeAction,
} from './inbox/InboxChrome';
import { useAddTaskDialog } from '@/presentation/components/forms/AddTaskDialogProvider';
import { COLUMN_SCROLL_CLASS, ColumnPreviewList } from './ColumnPreview';
import { SyncedStickyScrollbar } from './SyncedStickyScrollbar';
import { InlineNewCard, type InlineTaskSettings } from './InlineNewCard';
import { matchesInboxQuery } from './inbox/searchTasks';
import { BulkActionBar } from './BulkActionBar';
import {
  nextAnchor,
  nextSelection,
  type SelectModifiers,
} from './selection/selectionReducer';
import { useDragSelect } from './selection/useDragSelect';
import { useCrossProjectBulkActions } from '@/presentation/hooks/useCrossProjectBulkActions';
import { TaskTitleText } from './TaskTitleText';
import { OPEN_TASK_CARD_CLASS, TASK_CARD_BODY_CLASS, taskCardTitleClass } from './taskCardText';
import { splitTitleBody, plainTaskTitle } from '@/lib/taskTitleBody';
import { Markdown } from '@/presentation/components/markdown/Markdown';
import { InboxCheckbox } from './InboxCheckbox';
import { AssigneeBadge } from './AssigneeBadge';
import { PriorityBadge } from './PriorityBadge';
import { DeadlineBadge } from './DeadlineBadge';
import { AwaitingReplyBadge } from './AwaitingReplyBadge';
import { useAwaitingReply } from '@/presentation/hooks/AwaitingReplyProvider';
import { RalphModeBadge } from './RalphMode';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import {
  asAssignedInboxBlockTask,
  buildToMeInboxBlockTasks,
  canOpenMemberBoard,
  canSendToApproval,
  selectApprovalTasks,
  selectBoardTasks,
  type InboxBlockTask,
} from './inboxBlockTasks';

type Props = {
  // Снимок именно нижней inbox-доски. null = доска ещё не закончила первую загрузку.
  // Свои задачи виртуально зеркалятся в верхнюю личную колонку без дублирования в БД.
  boardTasks: readonly Task[] | null;
  inboxProjectId: string;
  // Колбэк после смены ответственного/toggle — InboxPage перефетчит доску ниже.
  onChanged?: () => void;
  // Заголовок страницы и её действия («Выделить») — блок ставит их в свою первую строку
  // рядом с вкладками, людьми и поиском (дизайн C4: одна строка управления над доской).
  heading?: React.ReactNode;
  actions?: React.ReactNode;
  // Скрыть выполненные (status='done'). Действует и на этот блок, и на доску ниже — один
  // тумблер на страницу (persist в localStorage у InboxPage). Тумблер живёт внутри кнопки
  // «Фильтры» этого блока, поэтому нужен и сеттер.
  hideDone?: boolean;
  onHideDoneChange?: (v: boolean) => void;
  // Режим мультивыделения СРАЗУ ВО ВСЕХ колонках блока: кнопка «Выделить» живёт в шапке
  // страницы «Входящие», поэтому состояние приходит снаружи. Выключение (Esc, крестик на
  // панели действий, полностью успешное массовое действие) блок сообщает обратно.
  selectionActive?: boolean;
  onSelectionActiveChange?: (active: boolean) => void;
};

// Тип вкладки блока ответственных: «Для меня» / «Другим».
type AssigneeTab = AssigneeDirection;

// done-задачи прячутся Eye-toggle'ом страницы; фильтр общий для обеих вкладок.
const notDone = (t: InboxBlockTask): boolean => t.status !== 'done';

// Все бакеты сортировки «по приоритету» (ключи groupByPriority): если какие-то из них
// не видны колонками, при drag'е с доски появляется фантом «Другой приоритет…».
const PRIORITY_BUCKET_KEYS = ['1', '2', '3', '4', 'none'] as const;

// Коллизии по КУРСОРУ (pointerWithin) — целиться в мелкие кубики людей и колонки проще, чем
// «прямоугольником» всей карточки (дефолтный rectIntersection часто мазал мимо → «тяжело
// попасть»). Фолбэк на rectIntersection, когда курсор в зазоре между целями.
export const dndCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

// Центрируем «комок»-оверлей на курсоре (аналог snapCenterToCursor из @dnd-kit/modifiers,
// который не установлен) — маленькая пилюля едет ровно под курсором, а не с отступом.
export const snapToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (draggingNodeRect && activatorEvent) {
    const coords = getEventCoordinates(activatorEvent);
    if (!coords) return transform;
    return {
      ...transform,
      x: transform.x + coords.x - draggingNodeRect.left - draggingNodeRect.width / 2,
      y: transform.y + coords.y - draggingNodeRect.top - draggingNodeRect.height / 2,
    };
  }
  return transform;
};

// Верхний блок «Входящих», две вкладки: «Для меня» — личные зеркала нижней доски плюс
// задачи текущего ответственного по всем проектам; «Другим» — видимые задачи, за которые
// отвечает кто-то ещё. Фильтры — по ответственному и проекту. Обе вкладки грузятся вместе
// (счётчики в табах всегда актуальны). Группировка списка переключаемая
// (проект/дата создания/дедлайн/приоритет) и сохраняется за аккаунтом (users.ui_prefs).
// Назначение ответственного мгновенное, без принятия/отказа. Чекбокс доступен по
// task-scoped праву caller'а (canModify с сервера). Клик открывает TaskDrawer.
// Горизонтальный скролл ряда канбанов «Входящих»: по умолчанию САМОЕ ЛЕВОЕ (0),
// позиция переживает перезагрузку (sessionStorage). Запрос: «когда верхние канбаны
// не вмещаются — не уезжать вправо, старт слева, скролл сохранять при reload».
function usePersistentScrollLeft(storageKey: string): {
  setRef: (el: HTMLDivElement | null) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
} {
  const rafRef = useRef<number | null>(null);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      let saved = 0;
      try {
        const v = Number(sessionStorage.getItem(storageKey));
        if (Number.isFinite(v) && v > 0) saved = v;
      } catch {
        /* ignore */
      }
      el.scrollLeft = saved; // явный старт слева (или сохранённая позиция)
    },
    [storageKey],
  );
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const left = e.currentTarget.scrollLeft;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        try {
          sessionStorage.setItem(storageKey, String(Math.round(left)));
        } catch {
          /* ignore */
        }
      });
    },
    [storageKey],
  );
  return { setRef, onScroll };
}

// Активная вкладка «Для меня»/«Другим» персистится за браузером (localStorage) — при
// перезагрузке открывается та же (просьба юзера). Grouping персистится серверно (ui_prefs),
// вкладку держим локально, чтобы не слать серверный запрос на каждый клик по вкладке.
const TAB_STORAGE_KEY = 'pf.inbox.assignedTab';
function readStoredTab(): AssigneeTab | null {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    return v === 'toMe' || v === 'byMe' ? v : null;
  } catch {
    return null;
  }
}

// Свёрнутая колонка «В работе» и свёрнутые колонки очереди (дизайн C4) — запоминаем за
// браузером: это раскладка рабочего места, серверу она не нужна.
const NOW_COLLAPSED_KEY = 'pf.inbox.nowCollapsed';
const MOBILE_SECTION_KEY = 'pf.inbox.mobileSection';
const MOBILE_BUCKET_ORDER: readonly string[] = ['today', 'future', 'none'];
function readStoredSection(): InboxSection | null {
  try {
    const v = localStorage.getItem(MOBILE_SECTION_KEY);
    return v === 'now' || v === 'queue' ? v : null;
  } catch {
    return null;
  }
}
const COLLAPSED_COLUMNS_KEY = 'pf.inbox.collapsedColumns';
function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function readStoredSet(key: string): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

// Minimum arrow scroll distance: two columns (256px each) including their gaps.
const MIN_COLUMN_SCROLL_STEP = 528;

// «Скрыть личные» на вкладке «Другим»: личные доски коллег могут занимать много колонок,
// поэтому выбор запоминаем между сессиями. По умолчанию — показывать.
const HIDE_PERSONAL_STORAGE_KEY = 'pf.inbox.hidePersonal';
function readStoredHidePersonal(): boolean {
  try {
    return localStorage.getItem(HIDE_PERSONAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AssignedToMeBlock({
  boardTasks,
  inboxProjectId,
  onChanged,
  heading,
  actions,
  hideDone = false,
  onHideDoneChange,
  selectionActive = false,
  onSelectionActiveChange,
}: Props): React.ReactElement | null {
  const { taskAssigneeRepository, taskRepository, userRepository, projectRepository } =
    useContainer();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { celebrate, forget } = useCompletedToday();
  // data — для фантомной колонки «Другой проект…» (условие «видны не все мои проекты»).
  const { data: allProjects } = useProjectsContext();
  // Принимает работу руководитель/владелец активного пространства. Нужно, чтобы показать
  // ему очередь приёмки даже пустой — иначе новую область попросту не находят. Остальным
  // пустую полку не показываем: это не их инструмент.
  const { data: workspaces } = useWorkspaces();
  const currentWorkspace = (workspaces ?? []).find((w) => w.isCurrent) ?? null;
  // Приёмка включена в пространстве вообще (независимо от роли смотрящего) — используется
  // отдельно от isApprover, чтобы решить, показывать ли полку рядовому исполнителю.
  const approvalEnabled = currentWorkspace?.requireTaskApproval === true;
  // Без воркера «В работе» ставят люди — такие задачи на полке «Вручную» (isHandWork).
  const workerEnabled = useWorkerEnabled();
  // «Передать воркеру» на карточке очереди — те же условия, что у кнопки на доске проекта.
  const workerHandoffAvailable = useWorkerHandoffAvailable();
  const isApprover =
    approvalEnabled && (currentWorkspace?.role === 'lead' || currentWorkspace?.role === 'owner');
  // Руководитель пространства смотрит доску сотрудника: клик по кубику переводит блок на
  // ВСЕ его незавершённые задачи по пространству (личные входящие + проекты, включая те,
  // где сам руководитель не участник — BUG D). Это РАСШИРЕНИЕ доступа к данным (не просто
  // ярлык к уже видимому), поэтому гейт целиком на сервере — см. ListMemberTasksForLead
  // (lead/owner пространства + memberId обязан быть участником того же пространства).
  // canOpenMemberBoard дополнительно требует kind === 'team' — см. её комментарий в
  // inboxBlockTasks.ts (личный дефолт-хаб структурно несовместим с этим жестом).
  const isWorkspaceLead = canOpenMemberBoard(currentWorkspace);
  // Состояние общее с диалогом быстрого добавления: он подставляет этого сотрудника
  // ответственным, чтобы задача, созданная с его доски, создавалась для него.
  const { member: focusedMember, setMember: setFocusedMember, setAssigneeFilter, setCreationFilters } = useFocusedInbox();
  const focusedMemberId = focusedMember?.userId ?? null;
  const [tasks, setTasks] = useState<AssignedTask[]>([]); // «Для меня»
  const [byMeTasks, setByMeTasks] = useState<AssignedTask[]>([]); // «Другим»
  // Личные (inbox) задачи коллег — отдельный источник, вливается во вкладку «Другим».
  // Сервер отдаёт их только по кругу общих рабочих пространств и всегда canModify: false.
  const [colleaguePersonalTasks, setColleaguePersonalTasks] = useState<AssignedTask[]>([]);
  // Очередь приёмки руководителя (ListApprovalQueue) — только для полки «На утверждении»:
  // задачи, которые он вправе принять, но не ставил сам. Во вкладки «Мне/Для всех» не вливается.
  const [approvalQueue, setApprovalQueue] = useState<AssignedTask[]>([]);
  // Доска сотрудника (клик по кубику руководителем) — отдельный источник: ВСЕ его
  // незавершённые задачи по всем проектам пространства, включая те, где сам руководитель
  // не участник (см. BUG D). Личных инбоксов colleaguePersonalTasks для этого мало.
  const [focusedResult, setFocusedResult] = useState<{ memberId: string; items: AssignedTask[] } | null>(null);
  const focusedMemberTasks = useMemo(() => focusedResult?.memberId === focusedMemberId ? focusedResult.items : [], [focusedResult, focusedMemberId]);
  const [focusedError, setFocusedError] = useState<string | null>(null);
  const [focusRetry, setFocusRetry] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const focusedLoading = focusedMemberId !== null && focusedResult?.memberId !== focusedMemberId && !focusedError;
  const [tab, setTab] = useState<AssigneeTab>(() => readStoredTab() ?? 'toMe');
  // Зафиксирован ли стартовый выбор вкладки: сохранённый выбор фиксирует его сразу,
  // иначе авто-переключение выполняется один раз после загрузки обоих источников.
  const tabSelectionResolvedRef = useRef(readStoredTab() !== null);
  // Явная смена вкладки юзером — персистим в localStorage и глушим авто-переключение.
  const handleTabChange = useCallback((next: AssigneeTab): void => {
    tabSelectionResolvedRef.current = true;
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setTab(next);
  }, []);
  // Фильтры вкладки «Другим»: ответственный и проект. null = все.
  const [filterTo, setFilterTo] = useState<string | null>(null);
  // Share the active person filter with the global creation dialog; clear it on navigation.
  useEffect(() => {
    setAssigneeFilter(tab === 'byMe' ? filterTo : null);
    return () => setAssigneeFilter(null);
  }, [tab, filterTo, setAssigneeFilter]);
  const [filterProject, setFilterProject] = useState<string | null>(null);
  // «Скрыть личные» — вкладка «Другим» может быть плотно забита личными досками коллег.
  // Персистим за браузером (как выбор вкладки), сервера это не касается.
  const [hidePersonal, setHidePersonal] = useState<boolean>(() => readStoredHidePersonal());
  const handleHidePersonalChange = useCallback((next: boolean): void => {
    try {
      localStorage.setItem(HIDE_PERSONAL_STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    setHidePersonal(next);
  }, []);
  // Поиск и фильтр по сроку (дизайн C4). Действуют на «Вручную» и очередь; полку приёмки
  // фильтрует только поиск — решение по сданной работе не прячется за сроком.
  const [query, setQuery] = useState('');
  const [due, setDue] = useState<DueKind | null>(null);
  // «Ответить»: вместо вкладок — задачи, где мне адресовали комментарий и я не ответил.
  const [replyOnly, setReplyOnly] = useState(false);
  useEffect(() => {
    setCreationFilters({ projectId: filterProject, due: due === 'today' || due === 'none' ? due : null });
    return () => setCreationFilters({ projectId: null, due: null });
  }, [filterProject, due, setCreationFilters]);
  const { animations } = useMotion();
  // Сворачивать колонки имеет смысл только на широком экране: на телефоне колонка и так
  // одна на экран, а полоска 38px только мешала бы листать.
  const canCollapse = useMediaQuery('(min-width: 768px)');
  // Широкий экран — доска «В работе + очередь» рядом; уже — разделы по одному (телефон).
  const isWide = canCollapse;
  // Раздел на телефоне: выбор пользователя (запоминаем) или null — решим по данным.
  const [mobileSection, setMobileSectionState] = useState<InboxSection | null>(() =>
    readStoredSection(),
  );
  // Метка прямо над липким переключателем разделов: по ней видно, что страницу уже
  // прокрутили ниже него.
  const sectionTopRef = useRef<HTMLDivElement>(null);
  const setMobileSection = useCallback((next: InboxSection): void => {
    try {
      localStorage.setItem(MOBILE_SECTION_KEY, next);
    } catch {
      /* ignore */
    }
    setMobileSectionState(next);
    // Переключились, пролистав раздел далеко вниз, — новый раздел открываем с начала, а не
    // с середины (или с пустоты под коротким списком). Пока переключатель на своём месте,
    // прокрутку не трогаем.
    const anchor = sectionTopRef.current;
    const scroller = anchor?.closest('[data-pf-main]');
    if (anchor && scroller && anchor.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
      anchor.scrollIntoView({ block: 'start' });
    }
  }, []);
  // Поле поиска на телефоне раскрывается по кнопке-лупе.
  const [searchOpen, setSearchOpen] = useState(false);
  const { open: openAddTask } = useAddTaskDialog();
  const [nowCollapsed, setNowCollapsed] = useState<boolean>(() => readStoredFlag(NOW_COLLAPSED_KEY));
  const toggleNowCollapsed = useCallback((): void => {
    setNowCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NOW_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const [collapsedColumns, setCollapsedColumns] = useState<ReadonlySet<string>>(() =>
    readStoredSet(COLLAPSED_COLUMNS_KEY),
  );
  const toggleColumnCollapsed = useCallback((key: string): void => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSED_COLUMNS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  // Подтверждение удаления карточки (кнопка-корзина в hover-панели).
  const [deleteTarget, setDeleteTarget] = useState<InboxBlockTask | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [grouping, setGrouping] = useState<AssignedGrouping>(DEFAULT_ASSIGNED_GROUPING);
  // Персист гор. скролла ряда канбанов (по вкладке+группировке): старт слева, reload сохраняет.
  const { setRef: setHScrollRef, onScroll: onHScroll } = usePersistentScrollLeft(
    `pf:inbox-hscroll:${tab}:${grouping}`,
  );
  // Закреплённый снизу вьюпорта горизонтальный скролл-бар ряда верхних канбанов (как на
  // досках проектов): держим ref на сам скролл-контейнер, чтобы SyncedStickyScrollbar
  // зеркалил его scrollLeft. Комбинированный callback-ref — и persist-скролл, и sticky-бар.
  const hScrollElRef = useRef<HTMLDivElement>(null);
  // Сам ряд — в состоянии ради шапки очереди: края прокрутки (кнопки ‹ ›) она считает сама,
  // подписавшись на ряд. Меняется только при смене ряда, а не на каждой прокрутке: состояние
  // краёв здесь перерисовывало весь блок и подвешивало прокрутку вбок.
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const setRowRef = useCallback(
    (el: HTMLDivElement | null): void => {
      hScrollElRef.current = el;
      setHScrollRef(el);
      setRowEl(el);
    },
    [setHScrollRef],
  );
  const scrollColumns = (direction: -1 | 1): void => {
    const row = hScrollElRef.current;
    if (!row) return;
    // Page through wide boards while keeping some context from the previous page.
    const step = Math.max(MIN_COLUMN_SCROLL_STEP, Math.round(row.clientWidth * 0.85));
    row.scrollBy({
      left: direction * step,
      behavior: animations ? 'smooth' : 'auto',
    });
  };
  const [loading, setLoading] = useState(true);
  const [drawerTask, setDrawerTask] = useState<InboxBlockTask | null>(null);
  // Зеркало hideDone для mount-эффекта: prop не в deps (иначе refetch на каждый
  // Eye-toggle), а стартовую вкладку надо решать по ВИДИМЫМ спискам — иначе блок
  // открывался бы на «Для меня», пустой из-за скрытых done-задач. Синхронизация — в
  // эффекте (запись в ref во время рендера запрещена react-hooks/refs).
  const hideDoneRef = useRef(hideDone);
  useEffect(() => {
    hideDoneRef.current = hideDone;
  }, [hideDone]);

  // Debounce realtime events until the current refresh settles; never discard them.
  const lastRefreshAtRef = useRef(0);

  // Зеркало focusedMemberId для refresh(): refresh не должен зависеть от него напрямую —
  // иначе его identity меняется при каждом открытии/закрытии доски сотрудника, а refresh
  // стоит в deps mount-эффекта ниже (перечитал бы listMine/listOthers/listColleaguesPersonal
  // + getUiPrefs и заново мигнул скелетоном на КАЖДЫЙ клик по кубику — не то, ради чего он
  // существует). Читаем актуальное значение через ref в момент вызова.
  const focusedMemberIdRef = useRef(focusedMemberId);
  const refreshGeneration = useRef(0);
  const focusedGeneration = useRef(0);
  useEffect(() => {
    focusedMemberIdRef.current = focusedMemberId;
  }, [focusedMemberId]);

  const refresh = useCallback(async (propagateError = false): Promise<void> => {
    const generation = ++refreshGeneration.current;
    const focusedRequest = ++focusedGeneration.current;
    lastRefreshAtRef.current = Date.now();
    // Снимок на момент старта запроса — сверяем с актуальным ПОСЛЕ await (см. ниже), а не
    // просто читаем ref второй раз: доска могла закрыться и открыться на ДРУГОГО сотрудника
    // за время в полёте, и тогда актуальный id формально снова совпал бы со снимком, но
    // ответ всё равно принадлежал бы уже не тому запросу.
    const focusedAtStart = focusedMemberIdRef.current;
    try {
      const [mine, byMe, personal, queue, focused] = await Promise.all([
        taskAssigneeRepository.listMine(),
        taskAssigneeRepository.listOthers(),
        taskAssigneeRepository.listColleaguesPersonal(),
        taskAssigneeRepository.listApprovalQueue(),
        focusedAtStart
          ? taskAssigneeRepository.listMemberTasks(focusedAtStart)
          : Promise.resolve<AssignedTask[]>([]),
      ]);
      if (generation !== refreshGeneration.current) return;
      setLoadError(false);
      setTasks(mine);
      setByMeTasks(byMe);
      setColleaguePersonalTasks(personal);
      setApprovalQueue(queue);
      // Пишем focusedMemberTasks только если доска всё ещё открыта на ТОГО ЖЕ сотрудника —
      // иначе устаревший ответ перезаписал бы уже актуальные данные другого/пустого фокуса.
      if (focusedAtStart && focusedMemberIdRef.current === focusedAtStart && focusedRequest === focusedGeneration.current) {
        setFocusedResult({ memberId: focusedAtStart, items: focused });
      }
    } catch (e) {
      if (generation !== refreshGeneration.current) return;
      if (propagateError) throw e;
      setLoadError(true);
      toast.error('Не удалось загрузить задачи. Повторите попытку.');
    } finally {
      // Штампуем ещё раз ПОСЛЕ применения ответа, не только в начале запроса: на медленной
      // сети (ответ дольше 400мс) эхо этой же мутации от SSE прилетает уже за пределами
      // окна, отсчитанного от старта, и второй refetch всё равно проходит гвард ниже.
      // Отсчёт от конца — гвард действительно перекрывает момент, когда наши же данные
      // только-только легли в state.
      lastRefreshAtRef.current = Date.now();
    }
  }, [taskAssigneeRepository]);
  usePageRefresh(() => refresh(true));

  // Открыли доску сотрудника (клик по кубику) — подтягиваем его задачи сразу, не дожидаясь
  // следующей SSE-волны/фокуса. Закрыли доску — сбрасываем, чтобы старые карточки не мелькали
  // при повторном открытии другого сотрудника. Отдельный эффект (не refresh()): именно он
  // реагирует на смену focusedMemberId, а refresh остаётся стабильным между кликами.
  useEffect(() => {
    const generation = ++focusedGeneration.current;
    setFocusedError(null);
    if (!focusedMemberId) {
      setFocusedResult(null);
      return;
    }
    let cancelled = false;
    taskAssigneeRepository
      .listMemberTasks(focusedMemberId)
      .then((items) => {
        if (!cancelled && generation === focusedGeneration.current) setFocusedResult({ memberId: focusedMemberId, items });
      })
      .catch(() => {
        if (!cancelled && generation === focusedGeneration.current) {
          setFocusedError('Не удалось загрузить задачи сотрудника');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [focusedMemberId, taskAssigneeRepository, focusRetry]);

  // Пришли по ссылке из плашки «вам назначили задачу» — подсвечиваем карточку.
  useSpotlightTask(!loading && boardTasks !== null, refresh);

  useInboxRealtimeRefresh(refresh, lastRefreshAtRef);

  useEffect(() => {
    let cancelled = false;
    const generation = ++refreshGeneration.current;
    setLoading(true);
    // Обе вкладки + сохранённую группировку грузим вместе и гейтим первый рендер на всё —
    // блок не «мигает» дефолтной группировкой/счётчиками перед применением реальных.
    Promise.all([
      taskAssigneeRepository.listMine(),
      taskAssigneeRepository.listOthers(),
      taskAssigneeRepository.listColleaguesPersonal(),
      taskAssigneeRepository.listApprovalQueue(),
      userRepository.getUiPrefs(),
    ])
      .then(([mine, byMe, personal, queue, prefs]) => {
        if (cancelled) return;
        if (generation === refreshGeneration.current) {
          setTasks(mine);
          setByMeTasks(byMe);
          setColleaguePersonalTasks(personal);
          setApprovalQueue(queue);
        }
        // Сортировка ПЕРСИСТИТСЯ за аккаунтом (users.ui_prefs) — при перезагрузке та же.
        // (Была session-only «точка 4» — юзер передумал 2026-07-11.)
        if (prefs.inboxAssignedGrouping) setGrouping(prefs.inboxAssignedGrouping);
      })
      .catch(() => {
        if (!cancelled) { setLoadError(true); toast.error('Не удалось загрузить задачи. Повторите попытку.'); }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Перефетч при возврате на вкладку — ловим новые назначения без ручного refresh.
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      refreshGeneration.current += 1;
      focusedGeneration.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [taskAssigneeRepository, userRepository, refresh]);

  const handleGroupingChange = (next: AssignedGrouping): void => {
    // Оптимистично: сортировка применяется мгновенно, сохранение летит в фоне.
    setGrouping(next);
    void userRepository.setUiPrefs({ inboxAssignedGrouping: next }).catch((e: unknown) => {
      toast.error(`Не удалось сохранить сортировку: ${(e as Error).message}`);
    });
  };

  const handleToggled = (): void => {
    void refresh();
    onChanged?.();
  };

  // Keep the inline composer in its project column. New tasks are drafts assigned
  // to the focused/filtered colleague, or to the current user when no one is selected.
  const [composingProject, setComposingProject] = useState<string | null>(null);
  // Publish the acknowledged task before refreshing, so a delayed GET cannot hide it.
  const createInProjectColumn = useCallback(
    async (projectId: string, name: string, icon: string | null, settings: InlineTaskSettings): Promise<Task | null> => {
      if (!user) return null;
      const { assigneeUserId } = settings;
      const created = await taskRepository.create(projectId, {
        description: name,
        status: 'backlog',
        icon,
        assigneeUserId,
        deadline: settings.deadline,
        priority: settings.priority,
      });
      // Show the acknowledged write immediately. A pre-save GET must never remove it.
      ++refreshGeneration.current;
      ++focusedGeneration.current;
      const projectName = allProjects?.find((p) => p.id === projectId)?.name
        ?? [...tasks, ...byMeTasks, ...focusedMemberTasks].find((t) => t.projectId === projectId)?.projectName
        ?? 'Проект';
      const saved: AssignedTask = { ...created, projectName, isInbox: false, canModify: true };
      const insert = (items: AssignedTask[]): AssignedTask[] => [saved, ...items.filter((t) => t.id !== saved.id)];
      if (assigneeUserId === user.id) setTasks(insert);
      else setByMeTasks(insert);
      if (focusedMemberIdRef.current === assigneeUserId) setFocusedResult((prev) => ({ memberId: assigneeUserId, items: insert(prev?.memberId === assigneeUserId ? prev.items : []) }));
      // A new draft can fail a deadline/search filter or belong to «Мои» while the
      // composer was opened in «Для всех». Reveal its actual destination after save.
      setQuery('');
      setDue(null);
      if (assigneeUserId === user.id) {
        setFocusedMember(null);
        handleTabChange('toMe');
      } else if (focusedMemberId && focusedMemberId !== assigneeUserId) {
        setFocusedMember({ userId: assigneeUserId, displayName: created.assignee.displayName });
      } else if (!focusedMemberId) {
        setFilterTo(null);
        handleTabChange('byMe');
      }
      setMobileSection('queue');
      void refresh();
      onChanged?.();
      return created;
    },
    [user, focusedMemberId, taskRepository, allProjects, tasks, byMeTasks, focusedMemberTasks, handleTabChange, setFocusedMember, setMobileSection, refresh, onChanged],
  );

  // Удаление карточки блока — через тот же стильный диалог, что и на досках проектов
  // (не нативный confirm). handleDelete лишь открывает окно, удаляет confirmDelete.
  const handleDelete = (item: InboxBlockTask): void => {
    setDeleteTarget(item);
  };
  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    // Карточка уходит СРАЗУ, диалог закрывается сразу — сеть догоняет фоном. Раньше здесь
    // ждали и ответ сервера, и следующий за ним refresh(): секунда с лишним, за которую
    // казалось, что удаление не сработало.
    setPatches((prev) => withPatch(prev, target.id, { kind: 'hidden' }));
    setDeleteTarget(null);
    setDeleting(true);
    try {
      // projectId берём у самой задачи: в блоке лежат задачи из РАЗНЫХ проектов,
      // а не только из инбокса.
      await taskRepository.delete(target.projectId, target.id);
      toast.success('Задача удалена');
      handleToggled();
    } catch (err) {
      // Сеть подвела уже ПОСЛЕ того, как карточка исчезла — возвращаем её на место.
      dropPatch(target.id);
      toast.error(`Не удалось удалить: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleDrawerSubmit = async (input: {
    description: string;
    ralphMode?: RalphMode;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }): Promise<Task> => {
    if (!drawerTask) throw new Error('Нет открытой задачи');
    const updated = await taskRepository.update(drawerTask.projectId, drawerTask.id, {
      description: input.description,
      ralphMode: input.ralphMode,
      deadline: input.deadline,
      priority: input.priority,
    });
    return updated;
  };

  // Фильтр hide-done — ДО группировок и счётчиков (зеркало TaskListView): done-задачи
  // остаются в data, скрытие только визуальное. Блок из одних выполненных исчезает
  // целиком; вернуть их — тем же Eye-toggle'ом, что и доску ниже.
  // Оптимистичные правки: удаление и перенос на полки показываем СРАЗУ, не дожидаясь
  // ответа сервера и следующего за ним refresh() (три GET'а). Накладываются на все три
  // источника ниже; снимаются, когда сервер подтвердил (settledPatchIds) или когда
  // действие упало — тогда вызывающий снимает правку сам и показывает тост.
  const [patches, setPatches] = useState<PatchMap>(() => new Map());
  const dropPatch = useCallback((id: string): void => {
    setPatches((prev) => withoutPatches(prev, [id]));
  }, []);

  const toMeRaw = useMemo(
    () =>
      buildToMeInboxBlockTasks({
        assignedTasks: tasks,
        boardTasks: boardTasks ?? [],
        inboxProjectId,
        owner: user ? { id: user.id, displayName: user.displayName } : null,
      }),
    [tasks, boardTasks, inboxProjectId, user],
  );
  const toMeTasks = useMemo(() => applyPatches(toMeRaw, patches), [toMeRaw, patches]);
  // Вкладка «Все» = мои задачи + задачи других участников + личные доски коллег. Свои
  // включены: «Все» без своих читалось как странный отдельный список. Дедуп по id: задача,
  // которую я делегировал коллеге в ЕГО инбокс, приезжает из двух источников.
  const byMeRaw = useMemo(() => {
    const seen = new Set(toMeRaw.map((t) => t.id));
    const others: InboxBlockTask[] = [];
    for (const t of [...byMeTasks, ...colleaguePersonalTasks]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      others.push(asAssignedInboxBlockTask(t));
    }
    return [...toMeRaw, ...others];
  }, [toMeRaw, byMeTasks, colleaguePersonalTasks]);
  // «Скрыть личные» убирает личные доски коллег; свои личные задачи остаются.
  const isColleaguePersonal = useCallback(
    (t: InboxBlockTask): boolean => t.isInbox && t.assignee.userId !== user?.id,
    [user?.id],
  );
  const byMeDisplayTasks = useMemo(() => applyPatches(byMeRaw, patches), [byMeRaw, patches]);
  const toMeVisible = useMemo(
    () => (hideDone ? toMeTasks.filter(notDone) : toMeTasks),
    [toMeTasks, hideDone],
  );
  const byMeVisibleAll = useMemo(() => {
    const afterDone = hideDone ? byMeDisplayTasks.filter(notDone) : byMeDisplayTasks;
    return hidePersonal ? afterDone.filter((t) => !isColleaguePersonal(t)) : afterDone;
  }, [byMeDisplayTasks, hideDone, hidePersonal, isColleaguePersonal]);
  // Фильтры «ответственный / проект» — только вкладка «Другим», поверх hide-done.
  // Предикат вынесен: им же различаем причину пустоты (фильтры vs скрытые done).
  const matchesByMeFilters = useCallback(
    (t: InboxBlockTask): boolean =>
      (!filterTo || t.assignee.userId === filterTo) &&
      (!filterProject || t.projectId === filterProject),
    [filterTo, filterProject],
  );
  const byMeVisible = useMemo(
    () => byMeVisibleAll.filter(matchesByMeFilters),
    [byMeVisibleAll, matchesByMeFilters],
  );
  // Доска сотрудника: ВСЕ его незавершённые задачи по всем проектам пространства (личные
  // входящие + проектные — включая проекты, где сам руководитель не участник; см. BUG D).
  // groupAssignedTasks сам разложит по колонкам: «Личные · <имя>» + проектные.
  const focusedRaw = useMemo(() => {
    if (!focusedMemberId) return [];
    return focusedMemberTasks.map(asAssignedInboxBlockTask);
  }, [focusedMemberTasks, focusedMemberId]);
  const focusedTasks = useMemo(() => applyPatches(focusedRaw, patches), [focusedRaw, patches]);
  // Очередь приёмки руководителя — только для полки «На утверждении» (selectApprovalTasks).
  const approvalQueueRaw = useMemo(() => approvalQueue.map(asAssignedInboxBlockTask), [approvalQueue]);
  const approvalQueueTasks = useMemo(() => applyPatches(approvalQueueRaw, patches), [approvalQueueRaw, patches]);

  // Снимаем отработавшие правки, когда подъехали живые данные. Без этого оверрайд навсегда
  // затеняет реальный статус и прячет чужие изменения (ловушка InboxCheckbox.optimistic).
  useEffect(() => {
    setPatches((prev) => withoutPatches(prev, settledPatchIds(prev, [...toMeRaw, ...byMeRaw, ...focusedRaw, ...approvalQueueRaw])));
  }, [toMeRaw, byMeRaw, focusedRaw, approvalQueueRaw]);
  const focusedVisible = useMemo(
    () => (hideDone ? focusedTasks.filter(notDone) : focusedTasks),
    [focusedTasks, hideDone],
  );
  // Вопросы мне без ответа — свой источник: вопрос руководителю часто задают в чужой задаче,
  // которой нет ни в «Моих», ни в «Для всех».
  const { tasks: awaitingReplyList } = useAwaitingReply();
  const awaitingReplyTasks = useMemo(
    () => applyPatches(awaitingReplyList.map(asAssignedInboxBlockTask), patches),
    [awaitingReplyList, patches],
  );
  const replyFilterOn = replyOnly && !focusedMemberId;
  const visibleTasks = focusedMemberId
    ? focusedVisible
    : replyFilterOn
      ? awaitingReplyTasks
      : tab === 'toMe'
        ? toMeVisible
        : byMeVisible;
  // Ждём оба независимых источника (назначенные задачи + нижнюю доску), иначе быстрый endpoint
  // «Другим» успевал выбрать не ту стартовую вкладку до появления личных зеркал. Явный
  // сохранённый выбор пользователя при этом не перебиваем.
  useEffect(() => {
    if (loading || boardTasks === null || tabSelectionResolvedRef.current) return;
    // Дальнейшие обновления задач не должны самопроизвольно менять вкладку.
    tabSelectionResolvedRef.current = true;
    const mineShown = hideDoneRef.current ? toMeTasks.filter(notDone) : toMeTasks;
    const byMeShown = hideDoneRef.current
      ? byMeDisplayTasks.filter(notDone)
      : byMeDisplayTasks;
    setTab(mineShown.length === 0 && byMeShown.length > 0 ? 'byMe' : 'toMe');
  }, [loading, boardTasks, toMeTasks, byMeDisplayTasks]);
  const anyByMeFilter = filterTo !== null || filterProject !== null;
  // Опции фильтров — уникальные значения из СЫРОГО списка «Другим» (не из
  // отфильтрованного — иначе выбор значения выкидывал бы остальные из меню).
  const filterOptions = useMemo(() => {
    const to = new Map<string, string>();
    const projects = new Map<string, string>();
    // Берём объединённый список (делегированные + личные доски коллег), иначе коллеги,
    // у которых есть только личные задачи, не попадали бы в меню фильтров.
    for (const t of byMeDisplayTasks) {
      to.set(t.assignee.userId, t.assignee.displayName);
      // Подписываем ВЛАДЕЛЬЦЕМ входящих, а не ответственным: это разные люди, когда задача
      // из чужих личных назначена мне (раньше в меню светилось не то имя).
      projects.set(
        t.projectId,
        t.isInbox ? `Личные · ${t.inboxOwner?.displayName ?? '—'}` : t.projectName,
      );
    }
    const toArr = (m: Map<string, string>): { id: string; name: string }[] =>
      [...m.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { to: toArr(to), projects: toArr(projects) };
  }, [byMeDisplayTasks]);
  // Проект-фильтр сбрасываем, если проект исчез из данных (архив/удаление) — иначе вкладка
  // выглядела бы пустой без причины. Фильтр ответственного НЕ сбрасываем: клик по аватару
  // участника выставляет фильтр даже на того, у кого сейчас нет задач — держим выбор
  // активным и показываем пустое состояние. (Раньше сброс срабатывал сразу после клика по
  // участнику без задач → «фильтр сбрасывался, аватар не выделялся».)
  useEffect(() => {
    if (filterProject && !byMeDisplayTasks.some((t) => t.projectId === filterProject)) {
      setFilterProject(null);
    }
  }, [byMeDisplayTasks, filterProject]);
  // Группировку (проект/дата/дедлайн/приоритет) для СПИСКА делает чистый хелпер.
  // Направление = активная вкладка: влияет на подпись inbox-групп («Личные · кто/кому»).
  // Зона «В работе» — отдельная полка над колонками: то, чем человек занят сам.
  // Статус — 'manual' (ветка ВНЕ pipeline'а агента: Ralph такие задачи не берёт), а НЕ
  // 'in_progress': тот считается открытой работой диспетчера, и воркер выполнил бы задачу,
  // которую пользователь взял себе. Задачи полки ИСКЛЮЧЕНЫ из обычных групп, иначе одна
  // карточка висела бы в двух местах.
  // Поиск и срок — поверх вкладки/фильтров. Счётчики чипов считаем по задачам после поиска
  // (без учёта самого срока), иначе выбранный чип обнулял бы соседние.
  const today = ymd(startOfDay(new Date()));
  const normalizedQuery = query.trim().toLowerCase();
  const queriedTasks = useMemo(
    () => (normalizedQuery ? visibleTasks.filter((t) => matchesInboxQuery(t, normalizedQuery)) : visibleTasks),
    [visibleTasks, normalizedQuery],
  );
  // Приёмка руководителем (db/150). Состав полки зависит от роли, и это не косметика:
  //
  //  - ПРИНИМАЮЩИЙ видит очередь целиком — сумму обоих направлений, а не активной вкладки.
  //    Задачи на утверждении назначены исполнителям, поэтому на вкладке «Мои» их не бывает,
  //    и полка, привязанная к вкладке, оказывалась бы пустой ровно у того, кому она нужна.
  //  - ИСПОЛНИТЕЛЮ показываем ТОЛЬКО его собственные задачи. Раньше сюда попадали и чужие
  //    (из направления «Другим»): человек видел десятки карточек, которые не может ни
  //    принять, ни забрать — чужая очередь выдавалась за его собственную.
  //
  //  - НА ДОСКЕ СОТРУДНИКА полка показывает очередь ЭТОГО человека — источник и гейт см.
  //    в комментарии selectApprovalTasks (inboxBlockTasks.ts).
  //
  // Фильтры вкладок не применяем: очередь не должна прятаться за фильтром.
  const approvalTasksAll = useMemo(
    () =>
      selectApprovalTasks({ toMeTasks, byMeDisplayTasks, focusedTasks, queueTasks: approvalQueueTasks, focusedMemberId, isApprover }),
    [toMeTasks, byMeDisplayTasks, focusedTasks, approvalQueueTasks, focusedMemberId, isApprover],
  );
  const approvalQueried = useMemo(
    () => replyFilterOn
      ? awaitingReplyTasks.filter((task) => task.status === 'pending_approval' && matchesInboxQuery(task, normalizedQuery))
      : approvalTasksAll.filter((task) => matchesInboxQuery(task, normalizedQuery)
        && (focusedMemberId !== null || tab !== 'byMe' || (matchesByMeFilters(task) && (!hidePersonal || !isColleaguePersonal(task))))),
    [replyFilterOn, awaitingReplyTasks, approvalTasksAll, normalizedQuery, focusedMemberId, tab, matchesByMeFilters, hidePersonal, isColleaguePersonal],
  );
  const { section, dueCounts, manual: inProgressTasks, approvals: approvalTasks, queue: groupedTasks } = useMemo(
    () => selectInboxView({ tasks: queriedTasks, approvals: approvalQueried, today, due, section: mobileSection, wide: isWide, workerEnabled }),
    [queriedTasks, approvalQueried, today, due, mobileSection, isWide, workerEnabled],
  );
  // У кого из людей есть сданная работа — фиолетовая точка на их аватаре (только тому,
  // кто принимает: исполнителю чужая очередь ни о чём не говорит).
  const peopleWithApproval = useMemo(
    () => new Set(isApprover ? approvalTasksAll.map((t) => t.assignee.userId) : []),
    [approvalTasksAll, isApprover],
  );
  // Канонический порядок проектов (как в сайдбаре) — чтобы колонки project-группировки
  // стояли на месте и не переезжали, когда задача уходит с доски.
  const projectOrder = useMemo(() => (allProjects ?? []).map((p) => p.id), [allProjects]);
  const groups = useMemo(
    // На чужой доске подписываем «Личные · <имя>» (направление 'byMe') — иначе колонка
    // называлась бы «Личные» и читалась как свои.
    () =>
      groupAssignedTasks(
        groupedTasks,
        grouping,
        new Date(),
        focusedMemberId ? 'byMe' : tab,
        projectOrder,
      ),
    [groupedTasks, grouping, tab, projectOrder, focusedMemberId],
  );
  // group/priority/created/taskType-группировки (buildFixed/groupByProject в
  // assignedGrouping.ts) выбрасывают опустевшую группу из массива сразу — колонка исчезала
  // скачком, соседние колонки прыгали влево. Держим её ещё EXIT_MS с exiting:true, схлопывая
  // CSS-ом (см. рендер ниже), а не framer-layout (на тач отключён осознанно).
  const displayGroups = useExitingListItems(groups, (g) => g.key, EXIT_MS, `${tab}:${focusedMemberId ?? ''}:${grouping}`);
  // Канбан блока — всегда РОВНО 3 колонки по времени (Без срока / На сегодня /
  // Будущее), независимо от выбранной группировки. Колонки всегда все три, даже пустые.
  const kanbanGroups = useMemo(
    () => groupAssignedByTime(groupedTasks, new Date()),
    [groupedTasks],
  );

  // === Мультивыделение по ВСЕМУ блоку (кнопка «Выделить» в шапке страницы) ===
  // Колонки блока — это либо 3 временных бакета (сортировка «по дедлайну»), либо группы
  // выбранной сортировки. Выделение работает одинаково в обоих раскладах.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null); // якорь Shift-диапазона
  const selectionColumns = grouping === 'deadline' ? kanbanGroups : groups;
  // Bulk management uses the same server capability as individual controls.
  const columnSelectableGroups = selectionColumns.map((g) => g.items.filter((t) => t.canModify).map((t) => t.id));
  // Полки «На утверждении» и «Вручную» — такие же участники выделения, как колонки: раньше
  // при включении режима они просто пропадали с экрана, и до этих задач массовые действия
  // было не достать вовсе. Идут первыми, потому что первыми же и нарисованы — порядок
  // важен для Shift-диапазона и протяжки мышью, которые считают по этому же списку.
  const selectableGroups = [
    approvalTasks.filter((t) => t.canModify).map((t) => t.id),
    inProgressTasks.filter((t) => t.canModify).map((t) => t.id),
    ...columnSelectableGroups,
  ];
  const selectionOrderedIds = selectableGroups.flat();
  const selectableIds = new Set(selectionOrderedIds);
  const taskById = useMemo(() => new Map(visibleTasks.map((t) => [t.id, t])), [visibleTasks]);
  // Выбранные в визуальном порядке колонок — их же получает панель действий.
  const orderedSelectedIds = selectionOrderedIds.filter((id) => selectedIds.has(id));

  const exitSelection = useCallback((): void => {
    onSelectionActiveChange?.(false);
  }, [onSelectionActiveChange]);
  // Режим выключили снаружи — выбор уходит вместе с ним.
  useEffect(() => {
    if (selectionActive) return;
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    anchorRef.current = null;
  }, [selectionActive]);

  const handleSelectToggle = (taskId: string, mods: SelectModifiers): void => {
    if (!selectableIds.has(taskId)) return;
    // Якорь мог указать на исчезнувшую карточку (refetch/SSE) — тогда начинаем диапазон
    // заново от кликнутой, иначе Shift навсегда деградировал бы в одиночный тогл.
    const anchor =
      anchorRef.current && selectableIds.has(anchorRef.current) ? anchorRef.current : null;
    setSelectedIds((prev) => nextSelection(prev, taskId, mods, selectionOrderedIds, anchor));
    anchorRef.current = nextAnchor(taskId, mods, anchor);
  };
  // «Все» / «Очистить» в шапке колонки — по СВОЕЙ колонке: объединяем/вычитаем, чтобы
  // не сносить выбор, набранный в соседних.
  const handleSelectAllIn = (ids: readonly string[]): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    anchorRef.current = null;
  };
  const handleSelectNoneIn = (ids: readonly string[]): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    anchorRef.current = null;
  };

  // Данные шапки колонки по её порядковому номеру (selectableGroups идёт в том же
  // порядке, что и selectionColumns). null — режим выделения выключен. Возвращаем ЧИСТЫЕ
  // данные, без колбэков: замыкания, пишущие anchorRef, нельзя создавать в рендере
  // (react-hooks/refs) — сами обработчики передаются в JSX ссылками.
  const columnSelectionAt = (index: number): ColumnSelection | null => {
    if (!selectionActive) return null;
    // Индекс приходит от колонки, поэтому берём из колоночного списка, а не из общего
    // selectableGroups (там впереди ещё две полки).
    const ids = columnSelectableGroups[index] ?? [];
    return { count: ids.filter((id) => selectedIds.has(id)).length, ids };
  };

  // Протяжка мышью — тот же хук, что и на доске проекта (прокрас карточек под указателем).
  // В режиме выделения карточки блока не таскаются (см. DraggableTask), сенсоров на них
  // нет — жест наш целиком.
  const dragSelect = useDragSelect({
    enabled: selectionActive,
    orderedGroups: () => selectableGroups,
    getSelection: () => selectedIds,
    onPaint: (ids) => {
      const own = ids.filter((id) => selectableIds.has(id));
      const last = own[own.length - 1];
      if (last === undefined) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of own) next.add(id);
        return next;
      });
      anchorRef.current = last;
    },
    onRestore: (snapshot) => setSelectedIds(new Set(snapshot)),
  });

  // Esc выходит из режима. defaultPrevented пропускаем: открытый Radix-дропдаун/диалог
  // уже обработал Esc. Протяжка перехватывает Esc раньше (capture) и гасит только жест.
  useEffect(() => {
    if (!selectionActive) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) exitSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionActive, exitSelection]);

  // Массовые действия веером по проектам (задачи блока — из разных проектов).
  const selectedRefs = orderedSelectedIds.flatMap((id) => {
    const t = taskById.get(id);
    return t ? [{ id, projectId: t.projectId }] : [];
  });
  // Плоская функция, не useCallback: чтение реестра DnD (ref) внутри мемоизации ловит
  // react-hooks/preserve-manual-memoization — так же устроены соседние handleToggled/
  // confirmDelete. Мемоизацию берёт на себя React Compiler.
  const refreshAfterBulk = async (): Promise<void> => {
    await refresh();
    onChanged?.();
  };
  const crossProjectBulk = useCrossProjectBulkActions({
    refs: selectedRefs,
    onAfter: refreshAfterBulk,
  });
  // Проект набора: одно значение — экспорт-дайджест (project-scoped) доступен;
  // несколько — панель его гасит.
  const selectedProjectIds = new Set(selectedRefs.map((r) => r.projectId));
  const bulkProjectId = selectedProjectIds.size === 1 ? [...selectedProjectIds][0] ?? null : null;

  // === Drag'ом между временными колонками меняем ДЕДЛАЙН (не статус). ===
  // Карточку тащит только тот, у кого есть права (`canModify`). 8px-порог у мыши — клик по
  // карточке (открыть drawer) и чекбоксу не превращается в драг. Touch с задержкой 220 мс —
  // на мобиле скролл ленты колонок остаётся, драг стартует по долгому тапу.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  const [activeDrag, setActiveDrag] = useState<InboxBlockTask | null>(null);
  // Идёт ЛЮБОЙ drag общего контекста (в external-режиме — и карточки доски снизу):
  // кубики людей подсвечиваются как цели для обоих происхождений. activeDrag при этом
  // остаётся только для СВОИХ карточек (оверлей-пилюля и родная end-логика).
  const [dragActive, setDragActive] = useState(false);
  // Дроп в «Будущее» не применяет срок сразу — открывает всплывашку выбора (неделя / конец
  // месяца / конкретный день). null = закрыта.
  const [futureDrop, setFutureDrop] = useState<InboxBlockTask | null>(null);
  // Дроп на кубик ДРУГОГО участника не переназначает сразу — открывает подтверждение
  // В подтверждении видны текущий и новый ответственные. null = диалог закрыт.
  const [pendingReassign, setPendingReassign] = useState<{
    item: InboxBlockTask;
    member: SharedMember;
  } | null>(null);

  // Оптимистично проставить дедлайн задачи в обоих endpoint-списках.
  // Личное зеркало обновляется через useTasks нижней доски.
  const patchDeadlineLocal = useCallback((id: string, deadline: string | null): void => {
    const patch = (arr: AssignedTask[]): AssignedTask[] =>
      arr.map((t) => (t.id === id ? { ...t, deadline } : t));
    setTasks(patch);
    setByMeTasks(patch);
  }, []);

  const applyDeadline = useCallback(
    async (item: InboxBlockTask, deadline: string | null): Promise<void> => {
      const prev = item.deadline ?? null;
      if (prev === deadline) return;
      patchDeadlineLocal(item.id, deadline); // оптимистично — карточка сразу переезжает
      try {
        await taskRepository.update(item.projectId, item.id, { deadline });
      } catch (e) {
        patchDeadlineLocal(item.id, prev); // откат при ошибке
        toast.error(`Не удалось изменить срок: ${(e as Error).message}`);
      }
    },
    [patchDeadlineLocal, taskRepository],
  );

  // Кубики людей: все участники проектов пространства (shared-members) — цель для
  // drag-назначения. Грузим один раз; себя список уже не содержит (сервер исключает).
  const [members, setMembers] = useState<SharedMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    projectRepository
      .listSharedMembers()
      .then((m) => {
        if (!cancelled) setMembers(m);
      })
      .catch(() => {
        /* The task list remains usable when members are unavailable. */
      }).finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [projectRepository]);
  // Сотрудник выпал из пространства (или роль перестала быть руководящей) — возвращаемся
  // к своим входящим, иначе блок завис бы на пустой чужой доске без выхода.
  useEffect(() => {
    if (focusedMemberId === null) return;
    if (!isWorkspaceLead || (!membersLoading && !members.some((m) => m.id === focusedMemberId))) {
      setFocusedMember(null);
    }
  }, [focusedMemberId, isWorkspaceLead, members, membersLoading, setFocusedMember]);

  // === Дроп карточек ДОСКИ в колонки-группы (план inbox-grouped-dnd) ===
  // Идёт drag именно с нижней доски: общий контекст активен, а карточка не наша.
  // Этим гейтятся фантомные колонки и подсветка колонок-групп как целей.
  const boardDragActive = dragActive && activeDrag === null;
  // Мои проекты — цели переноса (кроме инбокса и архивных). Для условия фантомной
  // колонки «Другой проект…»: она нужна, только если колонками видны не все проекты.
  const myProjects = useMemo(
    () => (allProjects ?? []).filter((p) => !p.isInbox && p.status !== 'archived'),
    [allProjects],
  );
  const phantomProjectNeeded =
    grouping === 'project' &&
    myProjects.some((p) => !groups.some((g) => !g.isInbox && g.key === p.id));
  // «Другой приоритет…» — только если из 5 бакетов (Срочно…Без приоритета) видны не все.
  const phantomPriorityNeeded =
    grouping === 'priority' &&
    PRIORITY_BUCKET_KEYS.some((k) => !groups.some((g) => g.key === k));

  // Назначить ответственного дропом на участника. Операция одна для любого
  // предыдущего ответственного и идемпотентна.
  const reassignTo = useCallback(
    async (item: InboxBlockTask, member: SharedMember): Promise<void> => {
      if (member.id === item.assignee.userId) return;
      try {
        await taskRepository.assign(item.projectId, item.id, member.id);
        toast.success(`Ответственный — ${member.displayName}`);
        // Не await: перерисовка списков не должна удерживать жест (см. setWorkStatus).
        void refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось переназначить: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged],
  );

  // Забрать задачу себе — та же смена ответственного. В именованном проекте это
  // может сделать любой участник; Inbox дополнительно проверяет сервер.
  const reclaimToSelf = useCallback(
    async (item: InboxBlockTask): Promise<void> => {
      if (!user) return;
      if (item.assignee.userId === user.id) {
        toast.info('Задача уже назначена вам');
        return;
      }
      try {
        await taskRepository.assign(item.projectId, item.id, user.id);
        toast.success('Теперь вы ответственный');
        void refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось забрать: ${(e as Error).message}`);
      }
    },
    [user, taskRepository, refresh, onChanged],
  );

  // Отзыв задачи с утверждения самим исполнителем: «случайно нажал выполнено». Он же —
  // «Отменить» в тосте после сдачи работы. Оптимистичную правку снимаем сразу: иначе
  // карточка, сданная секунду назад, так и висела бы на полке приёмки.
  const withdrawApproval = useCallback(
    async (item: InboxBlockTask): Promise<void> => {
      dropPatch(item.id);
      try {
        await taskRepository.withdrawApproval(item.projectId, item.id);
        forget(item.id);
        toast.success('Задача снова в работе');
        await refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось забрать: ${(e as Error).message}`);
      }
    },
    [taskRepository, forget, refresh, onChanged, dropPatch],
  );

  // Вернуть задаче прежний статус — действие «Отменить» в тосте после жеста.
  const restoreStatus = useCallback(
    async (item: InboxBlockTask, status: TaskStatus): Promise<void> => {
      setPatches((prev) => withPatch(prev, item.id, { kind: 'status', status }));
      try {
        await taskRepository.move(item.projectId, item.id, {
          targetStatus: status,
          beforeTaskId: null,
          afterTaskId: null,
        });
        void refresh();
        onChanged?.();
      } catch (e) {
        dropPatch(item.id);
        toast.error(`Не удалось отменить: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged, dropPatch],
  );

  // «Готово» броском на нижнюю полосу. Там, где работу принимает руководитель, сервер
  // переводит 'done' исполнителя в 'pending_approval' — показываем сразу итоговый статус,
  // иначе оптимистичная правка разошлась бы с ответом сервера и не снялась.
  const completeTask = useCallback(
    async (item: InboxBlockTask): Promise<void> => {
      if (!item.canModify || item.status === 'done') return;
      const shownStatus: TaskStatus = approvalEnabled && !isApprover ? 'pending_approval' : 'done';
      setPatches((prev) => withPatch(prev, item.id, { kind: 'status', status: shownStatus }));
      try {
        await taskRepository.move(item.projectId, item.id, {
          targetStatus: 'done',
          beforeTaskId: null,
          afterTaskId: null,
        });
        celebrate(item.id);
        toast.success(shownStatus === 'done' ? 'Готово' : 'Отправлена на утверждение', {
          description: plainTaskTitle(item.description ?? '') || undefined,
          duration: 8000,
          action: {
            label: 'Отменить',
            onClick: () => {
              forget(item.id);
              void (shownStatus === 'done'
                ? taskRepository
                    .move(item.projectId, item.id, {
                      targetStatus: item.status,
                      beforeTaskId: null,
                      afterTaskId: null,
                      restore: true,
                    })
                    .then(() => {
                      dropPatch(item.id);
                      void refresh();
                      onChanged?.();
                    })
                    .catch((err: unknown) => {
                      toast.error(`Не удалось отменить: ${(err as Error).message}`);
                    })
                : withdrawApproval(item));
            },
          },
        });
        void refresh();
        onChanged?.();
      } catch (e) {
        dropPatch(item.id);
        toast.error(`Не удалось: ${(e as Error).message}`);
      }
    },
    [approvalEnabled, isApprover, taskRepository, celebrate, forget, dropPatch, refresh, onChanged, withdrawApproval],
  );

  // Перенос задачи в другой проект — бросок карточки на колонку проекта. Права проверяет
  // сервер (из личных — только владелец, из проекта — право переноса).
  const moveToProject = useCallback(
    async (item: InboxBlockTask, targetProjectId: string): Promise<void> => {
      const target = (allProjects ?? []).find((p) => p.id === targetProjectId);
      try {
        await taskRepository.assignToProject(item.projectId, item.id, targetProjectId);
        toast.success(target?.isInbox ? 'Перенесли в «Личные»' : `Перенесли в «${target?.name ?? 'проект'}»`, {
          description: plainTaskTitle(item.description ?? '') || undefined,
        });
        void refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось перенести: ${(e as Error).message}`);
      }
    },
    [allProjects, taskRepository, refresh, onChanged],
  );

  // Вспышка полки «В работе»: `key` растёт на каждое взятие задачи (булев флаг не дал бы
  // перезапустить анимацию на второй задаче подряд), `id` — какую карточку подсветить.
  const [workFlash, setWorkFlash] = useState<{ id: string; key: number } | null>(null);

  // Взять в работу / убрать из работы. 'manual' — «делаю руками», агент такие задачи
  // никогда не подхватывает; backlog — «Черновики», нейтральное «не занимаюсь сейчас».
  // Возврат НЕ в todo: в личных входящих это колонка «Воркер», задачу забрал бы Ralph.
  // 'todo' — только явная кнопка «Передать воркеру» на проектной карточке очереди.
  const setWorkStatus = useCallback(
    async (item: InboxBlockTask, next: 'manual' | 'backlog' | 'todo'): Promise<void> => {
      if (item.status === next) return;
      // Карточка переезжает на полку сразу, ещё до ответа сервера — иначе после дропа она
      // секунду висит на старом месте и жест читается как неудавшийся.
      setPatches((prev) => withPatch(prev, item.id, { kind: 'status', status: next }));
      // Вспышка полки — тоже сразу: она подтверждает жест, а не ответ сервера.
      if (next === 'manual') setWorkFlash((prev) => ({ id: item.id, key: (prev?.key ?? 0) + 1 }));
      try {
        await taskRepository.move(item.projectId, item.id, {
          targetStatus: next,
          beforeTaskId: null,
          afterTaskId: null,
        });
        // Отмена из тоста возвращает прежний статус: жест мог быть промахом.
        const prev = item.status;
        const message = next === 'manual' ? 'Взята в работу' : next === 'todo' ? 'Передана воркеру' : 'Вернули в очередь';
        toast.success(message, {
          description: plainTaskTitle(item.description ?? '') || undefined,
          duration: 8000,
          action: { label: 'Отменить', onClick: () => void restoreStatus(item, prev) },
        });
        void refresh();
        onChanged?.();
      } catch (e) {
        dropPatch(item.id);
        toast.error(`Не удалось: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged, dropPatch, restoreStatus],
  );

  // Отправить свою задачу на приёмку жестом. Явный 'pending_approval' сервер пропускает
  // без подмены (подмена срабатывает только на 'done'), а уведомление принимающему шлёт
  // сам MoveTask — отдельного вызова не нужно.
  const sendToApproval = useCallback(
    async (item: InboxBlockTask): Promise<void> => {
      // Как и на остальных полках: карточка на месте назначения сразу, сеть — фоном.
      setPatches((prev) => withPatch(prev, item.id, { kind: 'status', status: 'pending_approval' }));
      // Сдать работу жестом — то же закрытие, что и кнопкой «готово»: обе ведут в
      // 'pending_approval', и сервер считает этот статус выполненным наравне с 'done'
      // (countTasksCompletedByActorSince). Значит и пилюля «выполнено сегодня» обязана
      // расти одинаково — раньше у дропа она молчала до ближайшего обновления.
      celebrate(item.id);
      try {
        await taskRepository.move(item.projectId, item.id, {
          targetStatus: 'pending_approval',
          beforeTaskId: null,
          afterTaskId: null,
        });
        toast.success('Отправлена на утверждение', {
          description: plainTaskTitle(item.description ?? '') || undefined,
          duration: 8000,
          action: { label: 'Отменить', onClick: () => void withdrawApproval(item) },
        });
        void refresh();
        onChanged?.();
      } catch (e) {
        // Оптимистичный celebrate обязателен к откату на ошибке — иначе локальная цифра
        // навсегда разъедется с серверной (контракт useCompletedToday).
        forget(item.id);
        dropPatch(item.id);
        toast.error(`Не удалось отправить на утверждение: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged, dropPatch, celebrate, forget, withdrawApproval],
  );

  // Приёмка: принять работу (→ done) или вернуть исполнителю (→ in_progress). Сервер
  // пустит в done только руководителя/владельца — кнопки видит тот, кому это доступно,
  // но окончательное слово всё равно за гейтом в MoveTask.
  // Возврат работы требует объяснения (сервер отклонит пустое) — держим цель в состоянии
  // и открываем диалог, вместо мгновенного переноса.
  const [rejectTarget, setRejectTarget] = useState<InboxBlockTask | null>(null);

  // Сама сетевая мутация, БЕЗ конфетти/анимации — их ведёт ApprovalItemCard (flash→exit,
  // тот же паттерн, что и AcceptedCard.completePhase). Раньше конфетти и тост стреляли
  // сразу по ответу сервера, а карточка ждала ещё refresh() (3 GET) + onChanged() (ещё
  // GET) — ощущалось как «нажал, и ничего не произошло». Теперь карточка скрывается
  // локально ДО того, как эта функция вообще вызвана (после 500мс анимации), а refresh()
  // здесь — фоновая сверка снимка, её не ждём.
  const acceptApproval = useCallback(
    async (item: InboxBlockTask): Promise<void> => {
      await taskRepository.move(item.projectId, item.id, {
        targetStatus: 'done',
        beforeTaskId: null,
        afterTaskId: null,
      });
      toast.success('Задача принята');
      void refresh();
      onChanged?.();
    },
    [taskRepository, refresh, onChanged],
  );

  // Без useCallback: колбэк закрывает диалог через сеттер, а мемоизировать его незачем —
  // он уходит в один диалог, а не в мемоизированный список карточек.
  const rejectApproval = async (
    item: InboxBlockTask,
    comment: string,
    files: readonly File[],
  ): Promise<void> => {
    try {
      const { commentId } = await taskRepository.rejectApproval(item.projectId, item.id, comment);
      // Вложения — в ТОТ ЖЕ комментарий, что создал возврат: причина и скриншот приходят
      // исполнителю одним сообщением. Падение загрузки не откатывает сам возврат — задача
      // уже вернулась в работу, и молча «отменить» это было бы хуже, чем сказать про файл.
      for (const file of files) {
        try {
          await taskRepository.uploadCommentAttachment(item.projectId, item.id, commentId, file);
        } catch (err) {
          toast.error(`Не удалось приложить ${file.name}: ${(err as Error).message}`);
        }
      }
      // Возврат снимает задачу с рейтинга исполнителя, а у принимающего она и не
      // считалась: цифру всё равно пересчитываем с сервера — она общая на сессию.
      forget(item.id);
      toast.success('Возвращена в работу — комментарий добавлен');
      setRejectTarget(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleDragStart = (e: DragStartEvent): void => {
    setDragActive(true);
    const it = e.active.data.current?.item as InboxBlockTask | undefined;
    if (it) setActiveDrag(it);
  };
  const handleDragEnd = (e: DragEndEvent): void => {
    setActiveDrag(null);
    setDragActive(false);
    const over = e.over;
    const data = over?.data.current as
      | {
          type?: string;
          bucket?: string;
          member?: SharedMember;
          status?: 'manual' | 'backlog';
          grouping?: string;
          projectId?: string;
        }
      | undefined;
    const item = e.active.data.current?.item as InboxBlockTask | undefined;
    if (!over || !item || !data) return;
    // Бросок на полосу «Готово» внизу экрана — закрыть задачу.
    if (data.type === 'done') {
      void completeTask(item);
      return;
    }
    // Бросок на колонку другого проекта — перенести задачу в этот проект.
    if (data.type === 'group' && data.grouping === 'project' && data.projectId) {
      if (item.canModify && item.projectId !== data.projectId) {
        void moveToProject(item, data.projectId);
      }
      return;
    }
    // Дроп в полку «В работе» (и обратно в колонки — тем же типом).
    if (data.type === 'work' && data.status) {
      void setWorkStatus(item, data.status);
      return;
    }
    // Дроп в полку «На утверждении»: сдать свою работу. Предикат повторяем и здесь —
    // disabled на цели защищает от промаха мышью, но не от гонки состояний.
    if (data.type === 'approval') {
      if (canSendToApproval(item, user?.id ?? null)) void sendToApproval(item);
      return;
    }
    // Дроп на кубик человека → сменить ответственного с подтверждением. Дроп на СВОЙ
    // кубик → забрать себе сразу.
    if (data.type === 'user' && data.member) {
      if (user && data.member.id === user.id) void reclaimToSelf(item);
      // Дроп на кубик текущего ответственного — менять не на кого, но тихо не проглатываем:
      // сообщаем тостом, что задача уже у него (не открываем зря подтверждение).
      else if (data.member.id === item.assignee.userId)
        toast.info(`Задача уже у ${data.member.displayName}`);
      else setPendingReassign({ item, member: data.member });
      return;
    }
    if (data.type !== 'bucket') return;
    // Дроп в свою же колонку — no-op (не дёргаем сервер и не открываем зря всплывашку).
    const today = ymd(startOfDay(new Date()));
    const cur = item.deadline == null ? 'none' : item.deadline <= today ? 'today' : 'future';
    if (cur === data.bucket) return;
    if (data.bucket === 'none') void applyDeadline(item, null);
    else if (data.bucket === 'today') void applyDeadline(item, today);
    else if (data.bucket === 'future') setFutureDrop(item); // всплывашка выбора срока
  };
  // Отмена drag'а (Esc/потеря захвата): гасим оверлей и подсветку кубиков.
  const handleDragCancel = (): void => {
    setActiveDrag(null);
    setDragActive(false);
  };

  // Пока грузится — заголовок страницы уже на месте, под ним скелетон доски: при появлении
  // данных строка заголовка не «прыгает».
  if (loading || membersLoading || boardTasks === null) {
    return (
      <section id="assigned-to-me" className="flex flex-col gap-3">
        <InboxLoadingLayout heading={heading} />
      </section>
    );
  }

  // Быстрое действие карточки очереди: «Взять в работу» — то же, что перетащить её в
  // «Вручную» (статус 'manual', агент такие не берёт). Не предлагаем там, где задачей уже
  // занят воркер (в работе / ждёт уточнения), и для закрытой или сданной.
  if (loadError) return <section className="space-y-4">{heading}
    <p className="text-sm text-muted-foreground">Не удалось загрузить задачи этого пространства.</p>
    <Button variant="outline" onClick={() => { setLoading(true); void refresh().finally(() => setLoading(false)); }}>Повторить</Button>
  </section>;

  const canTake = (item: InboxBlockTask): boolean => item.canModify && canTakeToManual(item.status);
  const takeToWorkAction = (item: InboxBlockTask): React.ReactNode =>
    canTake(item) ? (
      <QuickAction
        label="Взять в работу"
        className="text-manual"
        onClick={() => void setWorkStatus(item, 'manual')}
      >
        <Play className="size-3 fill-current" />
      </QuickAction>
    ) : null;
  // «Передать воркеру» — только проектные задачи очереди: полки «Вручную»/«На утверждении»
  // рендерят свои действия, а в «Личных» колонка «Воркер» не для этого.
  const canHandOff = (item: InboxBlockTask): boolean =>
    workerHandoffAvailable && item.canModify && !item.isInbox && canSendToWorker(item.status);
  const workerHandoffAction = (item: InboxBlockTask): React.ReactNode =>
    canHandOff(item) ? (
      <QuickAction
        label={WORKER_HANDOFF_LABEL}
        className="text-primary"
        onClick={() => void setWorkStatus(item, 'todo')}
      >
        <WorkerHandoffIcon className="size-3.5" />
      </QuickAction>
    ) : null;
  // Свайп вправо на тач-экране — «дальше по процессу»: карточка очереди → в работу; карточка
  // «Вручную» → на утверждение (своя, где работу принимает руководитель) или в готово.
  const queueSwipe = (item: InboxBlockTask): SwipeAction | null =>
    !selectionActive && canTake(item)
      ? { label: 'Взять в работу', tone: 'manual', onCommit: () => void setWorkStatus(item, 'manual') }
      : null;
  const manualSwipe = (item: InboxBlockTask): SwipeAction | null => {
    if (selectionActive || !item.canModify) return null;
    if (approvalEnabled && canSendToApproval(item, user?.id ?? null)) {
      return { label: 'На утверждение', tone: 'approval', onCommit: () => void sendToApproval(item) };
    }
    return { label: 'Готово', tone: 'done', onCommit: () => void completeTask(item) };
  };
  // Карточка очереди — одна разметка для колонок на десктопе и групп на телефоне.
  const renderQueueCard = (
    item: InboxBlockTask,
    ghost: boolean,
    opts: { showCreatedAt?: boolean; hideProjectLabel?: boolean } = {},
  ): React.ReactNode => {
    const swipe = ghost ? null : queueSwipe(item);
    const card = (
      <AcceptedCard
        item={item}
        open={!ghost && drawerTask?.id === item.id}
        onOpen={() => setDrawerTask(item)}
        onChanged={handleToggled}
        onDelete={() => handleDelete(item)}
        extraActions={
          <>
            {takeToWorkAction(item)}
            {workerHandoffAction(item)}
          </>
        }
        showCreatedAt={opts.showCreatedAt ?? false}
        hideProjectLabel={opts.hideProjectLabel ?? false}
        selecting={selectionActive}
        selected={selectedIds.has(item.id)}
        onSelectToggle={handleSelectToggle}
      />
    );
    return (
      <DraggableTask
        key={item.id}
        item={item}
        disabled={!item.canModify || ghost}
        selecting={selectionActive}
        // Призрак (useExitingListItems) держит старый снимок карточки, пока доигрывает
        // схлопывание, — dnd-id суффиксуется, чтобы не затереть живую (см. draggableTaskId).
        ghost={ghost}
      >
        {swipe ? (
          <SwipeToAct action={swipe} disabled={dragActive}>
            {card}
          </SwipeToAct>
        ) : (
          card
        )}
      </DraggableTask>
    );
  };

  // Блок пуст, когда пусто В ОБЕИХ вкладках (с учётом hide-done). Открытая доска сотрудника
  // держит блок на экране, даже если своих задач нет вовсе, — иначе руководитель кликнул бы
  // по кубику и зона исчезла бы у него из-под рук. По той же причине руководителю с пустыми
  // входящими зона показывается ради самих людей: без них инструмент «открыть входящие
  // сотрудника» ему просто негде взять (тот же приём, что и с полкой приёмки).
  const hasAny =
    toMeVisible.length > 0 ||
    byMeVisibleAll.length > 0 ||
    focusedMemberId !== null ||
    (isWorkspaceLead && members.length > 0);
  // Единая кнопка «Фильтры»: сортировка (когда есть задачи) + скрыть-выполненные (всегда) +
  // фильтры ответственного/проекта (только вкладка «Для всех»).
  const hasLocalFilters =
    normalizedQuery !== '' || due !== null || filterTo !== null || filterProject !== null || replyFilterOn;
  const resetFilters = (): void => {
    setQuery('');
    setSearchOpen(false);
    setDue(null);
    setReplyOnly(false);
    setFilterTo(null);
    setFilterProject(null);
  };
  // Колонка «В работе» = полка приёмки + «Вручную». Приёмку видит и рядовой исполнитель:
  // это единственная цель дропа для «сдать первую задачу» жестом. В режиме выделения пустые
  // полки прячем: тащить в них нечего, а подсказка «перетащите сюда» врала бы.
  const filtersPopover = (
    <InboxFiltersPopover
      showSort={hasAny}
      // Фильтры «кому/проект» — про вкладку «Для всех»; на чужой доске фильтровать нечего.
      showFilters={hasAny && !focusedMemberId && tab === 'byMe' && byMeDisplayTasks.length > 0}
      grouping={grouping}
      onGroupingChange={handleGroupingChange}
      hideDone={hideDone}
      onHideDoneChange={onHideDoneChange}
      // «Скрыть личные» — только там, где личные доски коллег реально мешают.
      showHidePersonal={!focusedMemberId && tab === 'byMe'}
      hidePersonal={hidePersonal}
      onHidePersonalChange={handleHidePersonalChange}
      options={filterOptions}
      to={filterTo}
      project={filterProject}
      onTo={setFilterTo}
      onProject={setFilterProject}
      onResetFilters={() => {
        setFilterTo(null);
        setFilterProject(null);
      }}
    />
  );

  const subtitleBase = focusedMember
    ? 'Все задачи сотрудника по пространству — открыты вам как руководителю'
    : tab === 'toMe'
      ? 'Ваши задачи и то, что ждёт вашего решения'
      : 'Задачи других участников';
  // Пустая видимая вкладка: сначала честно про фильтры, затем про скрытые done
  // (непустой СЫРОЙ список без фильтров = всё выполнено и скрыто Eye-toggle'ом),
  // и только при реально пустых данных — «ничего нет».
  const emptyText = focusedMember
    ? // Сервер (ListMemberTasksForLead) уже не отдаёт done — ветки «выполнены и скрыты»
      // здесь быть не может, hideDone/notDone на этом списке всегда no-op.
      'У сотрудника пока нет незавершённых задач'
    : tab === 'toMe'
      ? toMeTasks.length > 0
        ? 'Все задачи выполнены и скрыты («Скрыть выполненные»)'
        : 'Назначенных вам задач пока нет'
      : byMeDisplayTasks.length === 0
        ? 'Задач пока нет'
        : anyByMeFilter && !byMeDisplayTasks.some(matchesByMeFilters)
          ? 'Под выбранные фильтры ничего не попадает'
          : // Фильтрам (если есть) в СЫРОМ списке что-то соответствует, но видимых нет —
            // значит, спрятал Eye-toggle, и говорим про него, а не виним фильтры.
            'Все подходящие задачи выполнены и скрыты («Скрыть выполненные»)';

  // «Мои / Все» или заголовок чужой доски (режим руководителя).
  const tabsOrFocus = focusedMember ? (
    // Режим чужой доски заменяет вкладки заголовком с именем: вкладки «Мои/Для всех»
    // тут не про что — показывается одна конкретная доска. Возврат — ×.
    <div className="flex h-12 min-w-0 items-center gap-1 rounded-lg bg-primary-soft pe-1 ps-2 sm:h-auto">
      <span className="min-w-0 truncate text-ui font-semibold">Задачи · {focusedMember.displayName}</span>
      <span className="shrink-0 text-meta tabular-nums text-muted-foreground">{focusedVisible.length}</span>
      <button
        type="button"
        onClick={() => setFocusedMember(null)}
        aria-label="Вернуться к своим входящим"
        title="Вернуться к своим входящим"
        className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground sm:size-6"
      >
        <X className="size-3.5" />
      </button>
    </div>
  ) : (
    <AssigneeTabs
      className="shrink-0"
      tab={tab}
      onChange={handleTabChange}
      toMeCount={toMeVisible.length}
      // #3: счётчик «Все» = РЕАЛЬНО отрисованный список (с учётом фильтров от/кому/
      // проект), а не сырой byMeVisibleAll — иначе при активном фильтре число на вкладке
      // расходилось с количеством видимых карточек («неверное количество»).
      byMeCount={byMeVisible.length}
    />
  );
  // Люди: своя ава (бросить задачу — забрать себе) и участники пространства (бросить —
  // назначить; клик — их задачи). В покое — аватары, во время перетаскивания — крупные
  // плитки с именем: в маленький кружок трудно попасть (задача 3a36e7e8).
  const people =
    user || members.length > 0 ? (
      <div role="group" aria-label="Люди" className="flex max-w-full flex-wrap items-start gap-2">
        {user && <SelfDropAvatar user={user} dragging={dragActive} />}
        {members.map((m) => (
          <UserCube
            key={m.id}
            member={m}
            dragging={dragActive}
            hasApproval={peopleWithApproval.has(m.id)}
            // Руководитель/владелец: клик открывает личные входящие сотрудника (на любой
            // вкладке). Остальным остаётся прежний клик-фильтр «кому» на «Для всех»
            // (спека 2026-07-13); руководителю тот же фильтр доступен в меню «Фильтры».
            // На «Мои» без обеих ролей пропы не передаём — аватар только drop-цель.
            {...(isWorkspaceLead
              ? {
                  filterActive: focusedMemberId === m.id,
                  onToggleFilter: () =>
                    setFocusedMember(
                      focusedMemberId === m.id ? null : { userId: m.id, displayName: userLabel(m) },
                    ),
                  hint: 'нажмите, чтобы открыть его входящие',
                }
              : tab === 'byMe'
                ? {
                    filterActive: filterTo === m.id,
                    onToggleFilter: () => setFilterTo((prev) => (prev === m.id ? null : m.id)),
                    hint: 'нажмите, чтобы показать его задачи',
                  }
                : {})}
          />
        ))}
      </div>
    ) : null;

  // Строка управления (дизайн C4): заголовок страницы, «Мои / Для всех», люди, поиск,
  // фильтры и действия страницы — одной строкой над доской.
  // Телефон: заголовок с иконками (лупа, фильтры, выделение) — отдельной строкой; вкладки и
  // люди — одной лентой, которая листается вбок, а не переносится в три строки; поле поиска
  // появляется по лупе (и остаётся, пока в нём есть текст).
  const searchVisible = searchOpen || query !== '';
  const headRow = isWide ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {heading}
      {hasAny && tabsOrFocus}
      {hasAny && people}
      <span className="flex-1" />
      {hasAny && <InboxSearch value={query} onChange={setQuery} className="w-60" />}
      <div className="flex items-center gap-1">
        {filtersPopover}
        {actions}
      </div>
    </div>
  ) : (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-10 items-center gap-1">
        {heading}
        <span className="flex-1" />
        {hasLocalFilters && <button type="button" onClick={resetFilters} aria-label="Сбросить фильтры" title="Сбросить фильтры"
          className="grid size-11 shrink-0 place-items-center rounded-lg text-primary-ink transition-colors hover:bg-hover active:bg-active">
          <RotateCcw className="size-4" />
        </button>}
        {filtersPopover}
        {actions}
      </div>
      {hasAny && (
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 max-w-[55%] shrink-0">{tabsOrFocus}</div>
          <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain py-1 px-1 pf-scrollbar-hide">{people}</div>
        </div>
      )}
    </div>
  );

  if (!hasAny) {
    return (
      <section id="assigned-to-me" className="flex flex-col gap-3">
        {headRow}
        <p className="py-12 text-center text-ui text-muted-foreground">{emptyText}</p>
      </section>
    );
  }

  const showApprovalZone = approvalTasks.length > 0 || (approvalEnabled && !selectionActive);
  const showManualZone = inProgressTasks.length > 0 || !selectionActive;
  const showNow = showApprovalZone || showManualZone;
  // Свёрнутая «В работе» раскрывается сама на время перетаскивания — иначе некуда бросить.
  const nowExpanded = !nowCollapsed || dragActive || !canCollapse;
  const collapseNowButton = canCollapse ? (
    <button
      type="button"
      onClick={toggleNowCollapsed}
      aria-label="Свернуть «В работе»"
      title="Свернуть «В работе»"
      className={cn(COLUMN_ACTION_CLASS, 'ms-auto')}
    >
      <ChevronsLeft className="size-3.5" />
    </button>
  ) : null;
  // Сколько карточек в очереди: «N» или «N из M», когда поиск/срок что-то спрятали.
  const queueGroups = grouping === 'deadline' ? kanbanGroups : groups;
  const queueShown = queueGroups.reduce((n, g) => n + g.items.length, 0);
  const queueTotal = selectBoardTasks(visibleTasks, workerEnabled).length;
  const queueCountText = queueShown === queueTotal ? String(queueTotal) : `${queueShown} из ${queueTotal}`;
  const emptyColumnText = hasLocalFilters ? 'Нет задач по фильтрам' : 'Задач нет';
  // Бросок в «Готово» — только для своей карточки, которую можно менять и которая не закрыта.
  const canDropToDone =
    activeDrag !== null && activeDrag.canModify && activeDrag.status !== 'done' && !selectionActive;
  const doneLabel =
    approvalEnabled && !isApprover ? 'Бросьте сюда, чтобы сдать на утверждение' : 'Бросьте сюда, чтобы отметить готовой';
  // Телефон: какой раздел показан. Пока задач в «В работе» нет совсем, а пользователь раздел
  // не выбирал, сразу открываем очередь — пустой первый экран ничего не даёт.
  const nowCount = approvalTasks.length + inProgressTasks.length;

  // Смысл группы очереди (колонка на десктопе, группа на телефоне): куда её можно бросить,
  // какая метка в шапке, можно ли создать в ней задачу, ключ сворачивания.
  const groupView = (group: (typeof groups)[number], exiting: boolean) => {
    // Колонка = реальный проект (группировка по проекту). Своя «Личные» — тоже проект
    // (инбокс), в неё тоже можно перенести; чужие «Личные · имя» — нет.
    const isProjectColumn = grouping === 'project' && (!group.isInbox || group.key === inboxProjectId);
    // Смысл дропа на группу: project → перенос задачи в проект; priority → смена приоритета
    // (только карточки доски). Призрак дроп не принимает.
    const dropData: Record<string, unknown> | null = exiting
      ? null
      : isProjectColumn
        ? { type: 'group', grouping: 'project', projectId: group.key }
        : grouping === 'priority' && boardDragActive
          ? { type: 'group', grouping: 'priority', priority: group.key }
          : null;
    const ownDropHere =
      activeDrag !== null && isProjectColumn && activeDrag.canModify && activeDrag.projectId !== group.key;
    // «+» на колонке-проекте (не на «Личных» коллег): задача создаётся в этом проекте на
    // текущего юзера. Гейт по canModify ≈ право создавать.
    const canQuickAdd =
      !exiting && grouping === 'project' && !group.isInbox && group.items.some((i) => i.canModify);
    const collapseKey = `${grouping}:${group.key}`;
    const tone = groupToneClass(grouping, group);
    const tag = (
      <span className={cn('pf-tag pf-tag-lg', grouping !== 'project' && 'pf-tag-plain', tone)}>
        {grouping !== 'project' && <GroupIcon mode={grouping} isInbox={group.isInbox} />}
        <span className="truncate">{group.label}</span>
      </span>
    );
    return { isProjectColumn, dropData, highlight: boardDragActive || ownDropHere, canQuickAdd, collapseKey, tone, tag };
  };
  const quickAddButton = (projectKey: string): React.ReactElement => (
    <button
      type="button"
      aria-label="Создать задачу в проекте"
      title="Создать задачу"
      onClick={() => setComposingProject((p) => (p === projectKey ? null : projectKey))}
      className={COLUMN_ACTION_CLASS}
    >
      <Plus className="size-3.5" />
    </button>
  );
  const composer = (projectKey: string): React.ReactNode =>
    composingProject === projectKey ? (
      // #2: инлайн-создание сверху колонки-проекта — ТОТ ЖЕ композер, что и на досках
      // проектов (InlineNewCard): Enter создаёт и оставляет поле для следующей, иконки,
      // blur-commit. Без модального окна.
      <InlineNewCard
        key={`${projectKey}:${focusedMemberId ?? filterTo ?? user?.id}`}
        projectId={projectKey}
        defaults={{
          assigneeUserId: focusedMemberId ?? (tab === 'byMe' ? filterTo : null) ?? user?.id,
          deadline: getTaskCreationDeadline(due === 'today' || due === 'none' ? due : null),
        }}
        onCreate={(name, icon, settings) => createInProjectColumn(projectKey, name, icon, settings)}
        onClose={() => setComposingProject(null)}
        onOpenFull={(task) => {
          setComposingProject(null);
          setDrawerTask({ ...task, projectName: allProjects?.find((p) => p.id === task.projectId)?.name ?? 'Проект', isInbox: false, canModify: true, displaySource: 'assigned' });
        }}
      />
    ) : null;

  // «В работе»: полка приёмки сверху, «Вручную» снизу — одна серая панель.
  const nowPanel = (
    <section
      aria-label="В работе"
      className="flex w-full shrink-0 flex-col rounded-xl bg-panel md:w-[284px]"
    >
      {showApprovalZone && (
        <ApprovalShelf
          items={approvalTasks}
          openTaskId={drawerTask?.id}
          selecting={selectionActive}
          selectedIds={selectedIds}
          onSelectToggle={handleSelectToggle}
          onOpen={(t) => setDrawerTask(t)}
          onChanged={handleToggled}
          onAccept={acceptApproval}
          onReject={(t) => setRejectTarget(t)}
          onWithdraw={(t) => void withdrawApproval(t)}
          isApprover={isApprover}
          currentUserId={user?.id ?? null}
          canDrop={activeDrag ? canSendToApproval(activeDrag, user?.id ?? null) : false}
          dragActive={dragActive}
          narrow={!isWide}
          headerEnd={collapseNowButton}
          className={showManualZone ? 'rounded-be-none' : undefined}
          {...(focusedMember
            ? { emptyHint: `Задач на утверждении от ${focusedMember.displayName} сейчас нет.` }
            : {})}
        />
      )}
      {showManualZone && (
        <InProgressShelf
          items={inProgressTasks}
          openTaskId={drawerTask?.id}
          onOpen={(t) => setDrawerTask(t)}
          onChanged={handleToggled}
          onDelete={handleDelete}
          renderActions={(t) => (
            <>
              {t.canModify && (
                <QuickAction
                  label="Вернуть в очередь"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => void setWorkStatus(t, 'backlog')}
                >
                  <RotateCcw className="size-3.5" />
                </QuickAction>
              )}
            </>
          )}
          swipe={manualSwipe}
          swipeDisabled={dragActive}
          narrow={!isWide}
          flashKey={workFlash?.key ?? 0}
          flashItemId={workFlash?.id ?? null}
          selecting={selectionActive}
          selectedIds={selectedIds}
          onSelectToggle={handleSelectToggle}
          dragActive={dragActive && activeDrag !== null && activeDrag.status !== 'manual'}
          headerEnd={showApprovalZone ? null : collapseNowButton}
          className={showApprovalZone ? 'rounded-bs-none border-bs border-panel-divider' : undefined}
        />
      )}
    </section>
  );

  // Десктоп: очередь — ряд колонок, листается вбок.
  const desktopQueue =
    visibleTasks.length === 0 ? (
      // Пустая активная вкладка при живой соседней: тихая строка вместо пустых колонок.
      <p className="rounded-xl bg-panel px-3 py-6 text-center text-ui text-muted-foreground">{emptyText}</p>
    ) : grouping === 'deadline' ? (
      // Группировка «Дедлайн» = 3 колонки по времени (Без срока / На сегодня / Будущее).
      // Drag между колонками меняет дедлайн; drag на аватар участника — назначает его.
      <div ref={setRowRef} onScroll={onHScroll} className={COLUMNS_ROW_CLASS}>
        {kanbanGroups.map((group, index) => {
          const collapseKey = `bucket:${group.key}`;
          return (
            <TimeBucketColumn
              key={group.key}
              bucket={group.key}
              label={group.label}
              count={group.items.length}
              collapsed={canCollapse && collapsedColumns.has(collapseKey)}
              onToggleCollapsed={canCollapse ? () => toggleColumnCollapsed(collapseKey) : undefined}
              selection={columnSelectionAt(index)}
              onSelectAll={handleSelectAllIn}
              onSelectNone={handleSelectNoneIn}
              onCardsPointerDown={dragSelect.onPointerDown}
            >
              {group.items.length === 0 ? (
                <p className="px-1.5 py-2 text-meta text-muted-foreground">{emptyColumnText}</p>
              ) : (
                <ColumnPreviewList
                  // key по вкладке+фильтрам: смена датасета ремаунтит список (не тащим
                  // позицию скролла колонки между вкладками).
                  key={[tab, filterTo ?? '', filterProject ?? ''].join('|')}
                  items={group.items}
                  getId={(item) => item.id}
                  renderItem={(item, cardExiting) => renderQueueCard(item, cardExiting)}
                />
              )}
            </TimeBucketColumn>
          );
        })}
      </div>
    ) : groups.length === 0 && !boardDragActive ? (
      <p className="rounded-xl bg-panel px-3 py-6 text-center text-ui text-muted-foreground">
        {hasLocalFilters ? 'Под фильтры ничего не попадает' : 'Очередь пуста'}
      </p>
    ) : (
      // Остальные сортировки (проект / дата создания / приоритет / тип): колонки-группы.
      // Пока тащат свою карточку, колонки других проектов принимают её (перенос в проект).
      <div ref={setRowRef} onScroll={onHScroll} className={COLUMNS_ROW_CLASS}>
        {boardDragActive && phantomProjectNeeded && (
          <PhantomDropColumn
            id="phantom-project"
            kind="project"
            icon={FolderKanban}
            label="Другой проект…"
            hint="Бросьте сюда, чтобы выбрать проект из списка"
          />
        )}
        {boardDragActive && phantomPriorityNeeded && (
          <PhantomDropColumn
            id="phantom-priority"
            kind="priority"
            icon={Flag}
            label="Другой приоритет…"
            hint="Бросьте сюда, чтобы выбрать приоритет"
          />
        )}
        {displayGroups.map(({ item: group, exiting }) => {
          // Индекс в РЕАЛЬНОМ groups (не в displayGroups — там есть ещё «призраки»
          // опустевших колонок) — columnSelectionAt индексирует именно groups/selectableGroups.
          // Для призрака индекса нет: выделение на исчезающей колонке не имеет смысла.
          const index = groups.findIndex((g) => g.key === group.key);
          const view = groupView(group, exiting);
          const columnSelection = index >= 0 ? columnSelectionAt(index) : null;
          const collapsed = canCollapse && collapsedColumns.has(view.collapseKey) && !exiting;
          return (
            // Обёртка-коллапс СНАРУЖИ droppable-колонки (не на самом её узле — droppable
            // ref живёт внутри GroupDropColumn) — overflow:hidden тут не задевает measure
            // dnd-kit'а над самим droppable/sortable-узлом. data-pf-collapse — едет и при
            // выключенных на тач анимациях (globals.css .pf-no-motion исключение).
            <div
              key={group.key}
              data-pf-collapse
              className="grid shrink-0 motion-safe:transition-[grid-template-columns] motion-safe:duration-300 motion-safe:ease-out"
              style={{ gridTemplateColumns: exiting ? '0fr' : '1fr' }}
            >
              <div className={cn('min-w-0', exiting ? 'overflow-hidden' : 'overflow-visible')}>
                <GroupDropColumn
                  id={`group-${grouping}-${group.key}`}
                  data={view.dropData}
                  highlight={view.highlight}
                  exiting={exiting}
                  className={cn(
                    collapsed ? COLLAPSED_COLUMN_CLASS : cn('group/col', INBOX_COLUMN_CLASS),
                    exiting &&
                      'pointer-events-none opacity-0 transition-opacity duration-200 motion-reduce:transition-none',
                  )}
                >
                  {collapsed ? (
                    <CollapsedColumnButton
                      label={group.label}
                      count={group.items.length}
                      toneClass={view.tone}
                      onExpand={() => toggleColumnCollapsed(view.collapseKey)}
                    />
                  ) : (
                    <>
                      <ColumnHead
                        tag={
                          view.isProjectColumn && !group.isInbox ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/projects/${group.key}`)}
                              title="Открыть проект"
                              className="flex min-w-0 rounded-[5px] transition-opacity hover:opacity-80"
                            >
                              {view.tag}
                            </button>
                          ) : (
                            view.tag
                          )
                        }
                        count={group.items.length}
                        selection={columnSelection}
                        onSelectAll={handleSelectAllIn}
                        onSelectNone={handleSelectNoneIn}
                      >
                        {view.canQuickAdd && quickAddButton(group.key)}
                        {canCollapse && !exiting && (
                          <button
                            type="button"
                            aria-label={`Свернуть «${group.label}»`}
                            title="Свернуть"
                            onClick={() => toggleColumnCollapsed(view.collapseKey)}
                            className={COLUMN_ACTION_CLASS}
                          >
                            <ChevronsLeft className="size-3.5" />
                          </button>
                        )}
                      </ColumnHead>
                      <div
                        onPointerDown={columnSelection ? dragSelect.onPointerDown : undefined}
                        className={cn('flex flex-col gap-[5px]', COLUMN_SCROLL_CLASS)}
                      >
                        {composer(group.key)}
                        {group.items.length === 0 && composingProject !== group.key && (
                          <p className="px-1.5 py-2 text-meta text-muted-foreground">{emptyColumnText}</p>
                        )}
                        <ColumnPreviewList
                          key={[grouping, group.key].join('|')}
                          items={group.items}
                          getId={(item) => item.id}
                          renderItem={(item, cardExiting) =>
                            renderQueueCard(item, exiting || cardExiting, {
                              showCreatedAt: grouping === 'created',
                              hideProjectLabel: grouping === 'project',
                            })
                          }
                        />
                      </div>
                    </>
                  )}
                </GroupDropColumn>
              </div>
            </div>
          );
        })}
      </div>
    );

  // Телефон: очередь — группы стопкой на всю ширину (проект/срок/приоритет — по текущей
  // группировке). Шапка группы сворачивает её; вбок ничего листать не нужно.
  // Сроки стопкой: сверху то, что горит («На сегодня», «Будущее»), «Без срока» — в конце
  // (на десктопе колонки идут слева направо как шкала, там порядок другой).
  const mobileBuckets = [...kanbanGroups].sort(
    (a, b) => MOBILE_BUCKET_ORDER.indexOf(a.key) - MOBILE_BUCKET_ORDER.indexOf(b.key),
  );
  const mobileQueue =
    visibleTasks.length === 0 ? (
      <p className="rounded-xl bg-panel px-3 py-6 text-center text-ui text-muted-foreground">{emptyText}</p>
    ) : queueShown === 0 && !boardDragActive ? (
      <p className="rounded-xl bg-panel px-3 py-6 text-center text-ui text-muted-foreground">
        {hasLocalFilters ? 'Под фильтры ничего не попадает' : 'Очередь пуста'}
      </p>
    ) : (
      <div className="flex flex-col gap-2">
        {grouping === 'deadline'
          ? mobileBuckets.map((group) => {
              const collapseKey = `bucket:${group.key}`;
              // Выделение считается по колонкам десктопа — индекс в исходном порядке сроков.
              const selection = columnSelectionAt(kanbanGroups.findIndex((g) => g.key === group.key));
              return (
                <MobileQueueGroup
                  key={group.key}
                  dropId={`bucket-${group.key}`}
                  dropData={{ type: 'bucket', bucket: group.key }}
                  highlight={dragActive}
                  actions={
                    selection ? (
                      <ColumnSelectionControls
                        selection={selection}
                        onAll={handleSelectAllIn}
                        onNone={handleSelectNoneIn}
                      />
                    ) : null
                  }
                  tag={
                    <span className={cn('pf-tag pf-tag-lg pf-tag-plain', BUCKET_TONE[group.key] ?? 'pf-tone-gray')}>
                      <TimeBucketIcon bucket={group.key} />
                      <span className="truncate">{group.label}</span>
                    </span>
                  }
                  count={group.items.length}
                  collapsed={collapsedColumns.has(collapseKey)}
                  onToggle={() => toggleColumnCollapsed(collapseKey)}
                >
                  {group.items.length === 0 ? (
                    <p className="px-1.5 py-2 text-meta text-muted-foreground">{emptyColumnText}</p>
                  ) : (
                    <ColumnPreviewList
                      key={[tab, filterTo ?? '', filterProject ?? ''].join('|')}
                      items={group.items}
                      getId={(item) => item.id}
                      renderItem={(item, cardExiting) => renderQueueCard(item, cardExiting)}
                    />
                  )}
                </MobileQueueGroup>
              );
            })
          : displayGroups.map(({ item: group, exiting }) => {
              const view = groupView(group, exiting);
              // Как на десктопе: индекс в реальном groups (у «призрака» его нет).
              const index = groups.findIndex((g) => g.key === group.key);
              const selection = index >= 0 ? columnSelectionAt(index) : null;
              return (
                <MobileQueueGroup
                  key={group.key}
                  dropId={`group-${grouping}-${group.key}`}
                  dropData={view.dropData}
                  highlight={view.highlight}
                  tag={view.tag}
                  count={group.items.length}
                  collapsed={collapsedColumns.has(view.collapseKey)}
                  onToggle={() => toggleColumnCollapsed(view.collapseKey)}
                  actions={
                    selection ? (
                      <ColumnSelectionControls
                        selection={selection}
                        onAll={handleSelectAllIn}
                        onNone={handleSelectNoneIn}
                      />
                    ) : view.canQuickAdd ? (
                      quickAddButton(group.key)
                    ) : null
                  }
                >
                  {composer(group.key)}
                  <ColumnPreviewList
                    key={[grouping, group.key].join('|')}
                    items={group.items}
                    getId={(item) => item.id}
                    renderItem={(item, cardExiting) =>
                      renderQueueCard(item, exiting || cardExiting, {
                        showCreatedAt: grouping === 'created',
                        hideProjectLabel: grouping === 'project',
                      })
                    }
                  />
                </MobileQueueGroup>
              );
            })}
      </div>
    );

  // Тело блока (дизайн C4 «Одна доска»): строка управления, строка сроков, затем доска —
  // закреплённая колонка «В работе» и очередь по проектам, которая листается вбок. На телефоне
  // вместо доски — переключатель разделов и один раздел на всю ширину.
  const body = (
    // Телефон: запас снизу под плавающую кнопку «Новая задача», чтобы последняя карточка
    // прокручивалась выше неё.
    <section id="assigned-to-me" className={cn('flex flex-col gap-3', !isWide && 'gap-2.5 pbe-20')}>
      {headRow}

      {/* Нулевая метка над переключателем; -mbe-2.5 гасит лишний зазор колонки. */}
      {!isWide && <div ref={sectionTopRef} aria-hidden className="-mbe-2.5" />}
      {!isWide && (
        // Липнет к верху при прокрутке: раздел переключается, не возвращаясь наверх.
        <div className="sticky inset-bs-0 z-20 -mx-4 flex flex-col gap-2 bg-background px-4 py-1.5 sm:-mx-6 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <InboxSectionSwitch
              className="min-w-0 flex-1"
              value={section}
              onChange={setMobileSection}
              nowCount={nowCount}
              queueCount={queueShown}
              nowAttention={isApprover && approvalTasks.some((t) => t.assignee.userId !== user?.id)}
            />
            <button
              type="button"
              aria-label={searchVisible ? 'Закрыть поиск' : 'Поиск по проектам и задачам'}
              aria-expanded={searchVisible}
              aria-controls="inbox-mobile-search"
              onClick={() => {
                setSearchOpen(!searchVisible);
                if (searchVisible) setQuery('');
              }}
              className={cn(
                'grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-panel text-muted-foreground transition-colors hover:bg-hover active:bg-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                searchVisible && 'border-primary/30 bg-primary/10 text-primary-ink',
              )}
            >
              {searchVisible ? <X className="size-4" /> : <Search className="size-4" />}
            </button>
          </div>
          {searchVisible && (
            <InboxSearch id="inbox-mobile-search" value={query} onChange={setQuery} autoFocus={searchOpen} />
          )}
        </div>
      )}

      <div
        className={cn(
          'flex items-center gap-x-2 gap-y-1.5',
          // Телефон: три равные колонки, все фильтры доступны без прокрутки.
          isWide ? 'flex-wrap' : 'min-w-0',
        )}
      >
        <DueFilterChips value={due} onChange={setDue} counts={dueCounts} wrap={isWide} />
        {!focusedMemberId && (replyFilterOn || awaitingReplyTasks.length > 0) && (
          <ReplyFilterChip
            active={replyFilterOn}
            count={awaitingReplyTasks.length}
            onToggle={() => setReplyOnly((on) => !on)}
          />
        )}
        {isWide && hasLocalFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium text-primary-ink transition-colors hover:bg-hover sm:h-[26px] sm:text-meta"
          >
            Сбросить фильтры
          </button>
        )}
        {isWide && <span className="flex-1" />}
        {isWide && <span className="hidden text-meta text-muted-foreground lg:inline">{subtitleBase}</span>}
      </div>

      {focusedError ? (
        <div role="alert" className="space-y-3 rounded-xl border p-4 text-sm">
          <p>{focusedError}</p><Button variant="outline" onClick={() => { setFocusedError(null); setFocusRetry((n) => n + 1); }}>Повторить</Button>
        </div>
      ) : focusedLoading ? <BoardSkeleton shelf={false} now columns={isWide ? 2 : 0} /> : isWide ? (
        <div className="flex flex-row items-start gap-2.5">
          {showNow &&
            (nowExpanded ? (
              nowPanel
            ) : (
              <button
                type="button"
                onClick={toggleNowCollapsed}
                aria-label="Развернуть «В работе»"
                title="Развернуть «В работе»"
                className="flex min-h-[200px] w-10 shrink-0 flex-col items-center gap-2.5 rounded-xl bg-panel py-2.5 text-meta font-semibold transition-colors hover:bg-active"
              >
                <span className="[writing-mode:vertical-rl]">В работе</span>
                <span className="tabular-nums text-approval">{approvalTasks.length}</span>
                <span className="tabular-nums text-manual">{inProgressTasks.length}</span>
              </button>
            ))}

          <section aria-label="Очередь" className="flex min-w-0 flex-1 flex-col gap-2">
            <QueueHeader
              label={QUEUE_LABEL[grouping]}
              count={queueCountText}
              onScroll={scrollColumns}
              scrollTarget={rowEl}
            />
            {desktopQueue}
            {/* Закреплённый снизу вьюпорта горизонтальный скролл ряда колонок — как на досках
                проектов. Живёт внутри очереди, а не под всем блоком: ширина полосы обязана
                совпадать с шириной ряда, иначе её ход короче на ширину полки «В работе» и
                последние колонки до неё не докручиваются. */}
            <SyncedStickyScrollbar target={rowEl} ctrlWheel />
          </section>
        </div>
      ) : section === 'now' ? (
        showNow ? (
          nowPanel
        ) : (
          // Режим выделения прячет пустые полки — раздел не подменяем очередью молча.
          <p className="rounded-xl bg-panel px-3 py-6 text-center text-ui text-muted-foreground">
            В «В работе» выбирать нечего
          </p>
        )
      ) : (
        <section aria-label="Очередь" className="flex min-w-0 flex-col gap-2">
          {mobileQueue}
        </section>
      )}

      {/* Цели броска на время перетаскивания своей карточки. Десктоп — полоса «Готово» внизу
          (остальные цели и так на экране). Телефон — док «В работу» / «Готово» над нижней
          навигацией: на экране один раздел, и полки «В работе» могут быть скрыты. */}
      {canDropToDone &&
        (isWide ? (
          <DoneDropBar label={doneLabel} />
        ) : (
          <MobileDragDock
            canWork={activeDrag !== null && activeDrag.status !== 'manual' && canTake(activeDrag)}
            finish={approvalEnabled && !isApprover ? 'approval' : 'done'}
          />
        ))}

      {/* Телефон: создать задачу — плавающая кнопка над нижней навигацией (не прячется
          за меню). На время перетаскивания и выделения её нет — внизу свои панели. */}
      {!isWide && !dragActive && !selectionActive && composingProject === null && (
        <button
          type="button"
          onClick={openAddTask}
          aria-label="Новая задача"
          className="fixed end-4 inset-be-[calc(5.25rem_+_env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-float transition-colors hover:bg-primary/90"
        >
          <Plus className="size-6" />
        </button>
      )}

      <TaskDrawer
        state={drawerTask ? ({ mode: 'edit', task: drawerTask } as TaskDrawerState) : null}
        // canModify с сервера = editor+ в проекте задачи (свои inbox — true): viewer,
        // открывший чужую пару из «Другим», получает read-only вместо 403 на каждом save.
        canEdit={drawerTask?.canModify ?? true}
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

      {/* Удаление карточки из hover-панели — тот же диалог, что и на досках проектов. */}
      {/* Возврат работы (db/150): без объяснения исполнитель не знает, что доделать, —
          поэтому комментарий обязателен и здесь, и на сервере. */}
      <RejectApprovalDialog
        task={rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onSubmit={(comment, files) => {
          if (rejectTarget) void rejectApproval(rejectTarget, comment, files);
        }}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        taskLabel={deleteTarget ? plainTaskTitle(deleteTarget.description ?? '') : null}
        onConfirm={() => void confirmDelete()}
        busy={deleting}
      />

      {/* Панель массовых действий — та же, что на доске проекта. Задачи блока живут в РАЗНЫХ
          проектах, поэтому действия разворачиваются веером (useCrossProjectBulkActions), а
          «В колонку» и экспорт гасятся: колонки настраиваются в каждом проекте своими, а
          дайджест сервер рендерит одним project-scoped запросом. */}
      {selectionActive && orderedSelectedIds.length > 0 && (
        <BulkActionBar
          selectedIds={orderedSelectedIds}
          projectId={bulkProjectId}
          isInbox
          currentUserId={user?.id ?? null}
          moveTargets={[]}
          moveDisabledReason="Колонки у каждого проекта свои — переносите задачи на его доске"
          bulk={crossProjectBulk}
          onExit={exitSelection}
        />
      )}

      {/* Дроп в колонку «Будущее» → выбор конкретного срока (неделя / конец месяца / день). */}
      <FutureDeadlineDialog
        open={futureDrop !== null}
        onClose={() => setFutureDrop(null)}
        onPick={(deadline) => {
          const it = futureDrop;
          setFutureDrop(null);
          if (it) void applyDeadline(it, deadline);
        }}
      />

      {/* Дроп на кубик другого участника → подтверждение смены ответственного. */}
      <AssigneeConfirmDialog
        open={pendingReassign !== null}
        taskTitle={pendingReassign ? plainTaskTitle(pendingReassign.item.description ?? '') : ''}
        from={
          pendingReassign
            ? {
                name: pendingReassign.item.assignee.displayName,
                avatarUrl: pendingReassign.item.assignee.avatarUrl,
              }
            : null
        }
        to={{
          name: pendingReassign?.member.displayName ?? '',
          avatarUrl: pendingReassign?.member.avatarUrl ?? null,
        }}
        onCancel={() => setPendingReassign(null)}
        onConfirm={() => {
          // Закрываем СРАЗУ, не дожидаясь assign + refresh: решение уже принято, а держать
          // модалку на время трёх GET'ов — это те самые «исчезло через 10 секунд».
          // Исход показывает тост из reassignTo (как в setWorkStatus и остальных жестах).
          const pending = pendingReassign;
          setPendingReassign(null);
          if (pending) void reassignTo(pending.item, pending.member);
        }}
      />
    </section>
  );

  return (
    // Один DndContext на всю зону: и временные колонки (drag → срок), и кубики людей
    // (drag → смена ответственного) — общие drop-цели одного перетаскивания карточки.
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={dndCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {body}
        <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
          {activeDrag ? <AssignedDragPill item={activeDrag} /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

// Оверлей перетаскивания назначенной задачи. Компактный «комок» под курсором вместо целой
// карточки: стартует крупнее → пружиной сжимается в маленькую пилюлю с названием.
// ПОЛУПРОЗРАЧНЫЙ (~55%) — сквозь него видно кубик участника/колонку, на которую целишься
// (сразу видно, кого назначаем). Мелкий оверлей = легче целиться (+ коллизии по курсору,
// см. dndCollision).
export function AssignedDragPill({ item }: { item: InboxBlockTask }): React.ReactElement {
  return <TaskDragPill title={plainTaskTitle(item.description ?? '') || 'Задача'} />;
}

// Общая drag-пилюля (Notion-style «взял задачу»): полупрозрачная (~55%) однострочная
// капсула с названием — сквозь неё видно колонку/цель, куда целишься. Используется
// ВЕЗДЕ, где таскают карточку канбана (доска проекта, инбокс — верхний И нижний блоки),
// чтобы drag выглядел одинаково: прозрачным и в одну строку.
export function TaskDragPill({ title }: { title: string }): React.ReactElement {
  return (
    <motion.div
      initial={{ scale: 1.25, opacity: 0.3 }}
      animate={{ scale: 1, opacity: 0.55 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 }}
      className="pointer-events-none flex max-w-[15rem] cursor-grabbing items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-float ring-1 ring-primary/40"
    >
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60" />
      <span className="truncate">{title || 'Задача'}</span>
    </motion.div>
  );
}

// Состояние выделения одной колонки блока: сколько её задач в выборе и как выбрать/снять
// всю колонку. Колонки блока разные (временной бакет / группа сортировки), а шапка у них
// в режиме выделения одинаковая — см. ColumnSelectionControls.
type ColumnSelection = {
  // Сколько задач ЭТОЙ колонки сейчас в выборе.
  readonly count: number;
  // Выделяемые задачи колонки (без прав — не в счёт): их и получают «Все»/«Очистить».
  readonly ids: readonly string[];
};

// «Выбрано N» + «Все» / «Очистить» в шапке колонки блока (зеркало шапки KanbanColumn на
// доске проекта). Кнопки действуют только по своей колонке.
function ColumnSelectionControls({
  selection,
  onAll,
  onNone,
}: {
  selection: ColumnSelection;
  onAll: (ids: readonly string[]) => void;
  onNone: (ids: readonly string[]) => void;
}): React.ReactElement {
  return (
    <span className="ms-auto flex shrink-0 items-center gap-0.5">
      <span className="tabular-nums text-2xs text-muted-foreground">
        Выбрано {selection.count}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-2xs max-sm:h-9"
        disabled={selection.ids.length === 0}
        onClick={() => onAll(selection.ids)}
      >
        Все
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-2xs max-sm:h-9"
        disabled={selection.count === 0}
        onClick={() => onNone(selection.ids)}
      >
        Очистить
      </Button>
    </span>
  );
}

// === Колонки доски «Входящих» (дизайн C4) ===
// Колонка — серая панель 256px с радиусом 10px, карточки внутри с зазором 5px; шапка 28px:
// метка-тон, счётчик, действия справа. Свёрнутая колонка — вертикальная полоска 38px.
const INBOX_COLUMN_CLASS =
  'flex w-[86vw] max-w-[22rem] shrink-0 snap-center snap-always flex-col gap-[5px] rounded-xl bg-panel p-1.5 transition-[background-color,outline-color] duration-150 sm:w-64 sm:max-w-none';
const COLLAPSED_COLUMN_CLASS =
  'flex min-h-[200px] w-[38px] shrink-0 flex-col rounded-xl bg-panel transition-[background-color,outline-color] duration-150';
// Ряд колонок: свой скролл вбок, родная полоса спрятана — видимую и закреплённую снизу даёт
// SyncedStickyScrollbar (иначе внизу второй «раздвоенный» бар, как на доске).
const COLUMNS_ROW_CLASS =
  'flex items-start snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-none pbe-2 sm:snap-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
// Иконка-кнопка в шапке колонки («+», «свернуть»): 24px на десктопе, 36px на тач-экранах.
const COLUMN_ACTION_CLASS =
  'grid size-9 shrink-0 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground sm:size-6';
// Подсветка колонки как цели броска: штрих — «сюда можно», сплошная синяя — «отпустите».
const DROP_TARGET_CLASS = 'outline outline-1 -outline-offset-2 outline-dashed outline-drop-line';
const DROP_OVER_CLASS = 'bg-drop outline outline-2 -outline-offset-2 outline-primary';

const QUEUE_LABEL: Record<AssignedGrouping, string> = {
  project: 'Очередь по проектам',
  deadline: 'Очередь по срокам',
  priority: 'Очередь по приоритету',
  created: 'Очередь по дате создания',
  taskType: 'Очередь по типу',
};

// Тон метки в шапке колонки: проект — его постоянный цвет (как в сайдбаре), приоритет —
// от красного «Срочно» к синему «Низкий», остальное — нейтральный серый.
const PRIORITY_TONE: Record<string, string> = {
  '1': 'pf-tone-red',
  '2': 'pf-tone-orange',
  '3': 'pf-tone-yellow',
  '4': 'pf-tone-blue',
  none: 'pf-tone-gray',
};
function groupToneClass(
  grouping: AssignedGrouping,
  group: { readonly key: string; readonly isInbox: boolean },
): string {
  if (grouping === 'project') return projectToneClass(group.key, group.isInbox);
  if (grouping === 'priority') return PRIORITY_TONE[group.key] ?? 'pf-tone-gray';
  return 'pf-tone-gray';
}

// Шапка колонки: метка, счётчик (или «Выбрано N · Все · Очистить» в режиме выделения) и
// действия колонки справа.
function ColumnHead({
  tag,
  count,
  selection = null,
  onSelectAll,
  onSelectNone,
  children,
}: {
  tag: React.ReactNode;
  count: number;
  selection?: ColumnSelection | null;
  onSelectAll?: (ids: readonly string[]) => void;
  onSelectNone?: (ids: readonly string[]) => void;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 px-[3px] text-ui">
      <span className="flex min-w-0 items-center">{tag}</span>
      {selection && onSelectAll && onSelectNone ? (
        <ColumnSelectionControls selection={selection} onAll={onSelectAll} onNone={onSelectNone} />
      ) : (
        <>
          <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
          <span className="ms-auto flex shrink-0 items-center gap-0.5">{children}</span>
        </>
      )}
    </div>
  );
}

// Свёрнутая колонка: вертикальное имя и число; клик разворачивает. Бросать карточку можно и
// на свёрнутую — droppable живёт на обёртке (GroupDropColumn).
function CollapsedColumnButton({
  label,
  count,
  toneClass,
  onExpand,
}: {
  label: string;
  count: number;
  toneClass: string;
  onExpand: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Развернуть «${label}»`}
      title={label}
      className="flex w-full flex-1 flex-col items-center gap-2 rounded-xl py-2.5 text-meta font-semibold transition-colors hover:bg-hover"
    >
      <span aria-hidden className={cn('size-2 shrink-0 rounded-[3px] bg-tone', toneClass)} />
      <span className="max-h-48 overflow-hidden [writing-mode:vertical-rl]">{label}</span>
      <span className="tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

// Свайп-обёртка карточки: есть действие — SwipeToAct, нет — карточка как есть (лишний
// узел и слушатели touch не нужны).
function SwipeWrap({
  action,
  disabled = false,
  children,
}: {
  action: SwipeAction | null;
  disabled?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  if (!action) return <>{children}</>;
  return (
    <SwipeToAct action={action} disabled={disabled}>
      {children}
    </SwipeToAct>
  );
}

// Кнопка в плашке быстрых действий карточки (взять в работу, сдать, вернуть). Нажатие не
// проваливается в карточку и не стартует перетаскивание.
const QUICK_ACTION_CLASS =
  'grid size-6 shrink-0 place-items-center rounded-[5px] transition-colors hover:bg-hover max-sm:size-8';
function QuickAction({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(QUICK_ACTION_CLASS, className)}
    >
      {children}
    </button>
  );
}

// Полоса «Готово» внизу экрана на время перетаскивания: бросок закрывает задачу. Фиксирована
// над нижней навигацией на телефоне и у нижнего края на десктопе.
function DoneDropBar({ label }: { label: string }): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: 'done-bar', data: { type: 'done' } });
  return (
    <div className="pointer-events-none fixed inset-x-0 inset-be-[calc(5.5rem_+_env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:inset-be-6">
      <div
        ref={setNodeRef}
        className={cn(
          'pointer-events-auto flex items-center gap-2.5 rounded-xl border border-dashed px-5 py-3 text-task font-semibold text-done-ink shadow-float transition-colors duration-150',
          isOver ? 'border-done bg-done-soft-hover' : 'border-done/60 bg-done-soft',
        )}
      >
        <Check className="size-4 shrink-0" strokeWidth={2.4} />
        {label}
      </div>
    </div>
  );
}

// Группа очереди на телефоне: строка-заголовок (стрелка, метка, число, «+») сворачивает
// группу; карточки — стопкой на всю ширину. Тот же droppable, что у колонки на десктопе:
// бросок своей карточки на группу другого проекта переносит задачу.
function MobileQueueGroup({
  dropId,
  dropData,
  highlight,
  tag,
  count,
  collapsed,
  onToggle,
  actions = null,
  children,
}: {
  dropId: string;
  dropData: Record<string, unknown> | null;
  highlight: boolean;
  tag: React.ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: dropId, data: dropData ?? {}, disabled: dropData === null });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl bg-panel transition-[background-color,outline-color] duration-150',
        dropData !== null && highlight && (isOver ? DROP_OVER_CLASS : DROP_TARGET_CLASS),
      )}
    >
      <div className="flex items-center gap-1 pe-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 ps-2 text-start text-ui"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-150',
              !collapsed && 'rotate-90',
            )}
          />
          <span className="flex min-w-0 items-center">{tag}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
        </button>
        {actions}
      </div>
      {!collapsed && <div className="flex flex-col gap-[5px] px-1.5 pbe-1.5">{children}</div>}
    </div>
  );
}

// Док целей на время перетаскивания на телефоне — над нижней навигацией. На экране один
// раздел, и полки «В работе» могут быть скрыты; здесь цели всегда под пальцем.
const DOCK_KIND = {
  manual: { border: 'border-manual', icon: 'text-manual' },
  approval: { border: 'border-approval', icon: 'text-approval' },
  done: { border: 'border-done', icon: 'text-done' },
} as const;

function DockTarget({
  id,
  data,
  kind,
  icon,
  label,
}: {
  id: string;
  data: Record<string, unknown>;
  kind: keyof typeof DOCK_KIND;
  icon: React.ReactNode;
  label: string;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div
      ref={setNodeRef}
      // По нему смоук-тест находит цель броска (e2e/smoke, сценарий inbox-gestures).
      data-pf-dock-target={id}
      className={cn(
        'pointer-events-auto flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border-2 bg-raised px-2 text-xs font-semibold text-foreground shadow-float transition-[border-style,transform] duration-150',
        DOCK_KIND[kind].border,
        isOver ? 'border-solid motion-safe:scale-105' : 'border-dashed',
      )}
    >
      <span className={DOCK_KIND[kind].icon}>{icon}</span>
      <span className="max-w-full truncate">{label}</span>
    </div>
  );
}

// Цели две: «В работу» и «закончить». Закончить — та же полоса «Готово» (completeTask):
// у исполнителя при включённой приёмке она и так отправляет на утверждение, поэтому
// отдельная цель «На утверждение» рядом с ней дублировала бы её — меняется лишь подпись.
function MobileDragDock({
  canWork,
  finish,
}: {
  canWork: boolean;
  finish: 'done' | 'approval';
}): React.ReactElement {
  return (
    <div className="pointer-events-none fixed inset-x-0 inset-be-[calc(5.25rem_+_env(safe-area-inset-bottom))] z-40 flex gap-2 px-3">
      {canWork && (
        <DockTarget
          id="dock-work"
          data={{ type: 'work', status: 'manual' }}
          kind="manual"
          icon={<Play className="size-4 fill-current" />}
          label="В работу"
        />
      )}
      <DockTarget
        id="done-bar"
        data={{ type: 'done' }}
        kind={finish}
        icon={
          finish === 'approval' ? (
            <ShieldCheck className="size-4" />
          ) : (
            <Check className="size-4" strokeWidth={2.6} />
          )
        }
        label={finish === 'approval' ? 'На утверждение' : 'Готово'}
      />
    </div>
  );
}

// Колонка канбана «по сроку» (группировка «Дедлайн») = drop-зона: дроп меняет срок задачи
// на этот бакет. Вид — как у колонок проектов.
const BUCKET_TONE: Record<string, string> = {
  none: 'pf-tone-gray',
  today: 'pf-tone-orange',
  future: 'pf-tone-blue',
};
function TimeBucketColumn({
  bucket,
  label,
  count,
  collapsed = false,
  onToggleCollapsed,
  selection = null,
  onSelectAll,
  onSelectNone,
  onCardsPointerDown,
  children,
}: {
  bucket: string;
  label: string;
  count: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  // Режим выделения: счётчик + «Все»/«Очистить» по ЭТОЙ колонке. null — режим выключен.
  selection?: ColumnSelection | null;
  onSelectAll?: (ids: readonly string[]) => void;
  onSelectNone?: (ids: readonly string[]) => void;
  // Старт протяжки-выделения (см. useDragSelect) — на контейнере карточек.
  onCardsPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `bucket-${bucket}`,
    data: { type: 'bucket', bucket },
  });
  const tone = BUCKET_TONE[bucket] ?? 'pf-tone-gray';
  return (
    <div
      ref={setNodeRef}
      className={cn(
        collapsed ? COLLAPSED_COLUMN_CLASS : INBOX_COLUMN_CLASS,
        active && !isOver && DROP_TARGET_CLASS,
        isOver && DROP_OVER_CLASS,
      )}
    >
      {collapsed && onToggleCollapsed ? (
        <CollapsedColumnButton label={label} count={count} toneClass={tone} onExpand={onToggleCollapsed} />
      ) : (
        <>
          <ColumnHead
            tag={
              <span className={cn('pf-tag pf-tag-lg pf-tag-plain', tone)}>
                <TimeBucketIcon bucket={bucket} />
                <span className="truncate">{label}</span>
              </span>
            }
            count={count}
            selection={selection}
            {...(onSelectAll ? { onSelectAll } : {})}
            {...(onSelectNone ? { onSelectNone } : {})}
          >
            {onToggleCollapsed && (
              <button
                type="button"
                aria-label={`Свернуть «${label}»`}
                title="Свернуть"
                onClick={onToggleCollapsed}
                className={COLUMN_ACTION_CLASS}
              >
                <ChevronsLeft className="size-3.5" />
              </button>
            )}
          </ColumnHead>
          <div
            // Хук пассивен вне режима выделения, но лишний слушатель на обычной колонке не вешаем.
            onPointerDown={selection ? onCardsPointerDown : undefined}
            className={cn('flex min-h-[3rem] flex-col gap-[5px]', COLUMN_SCROLL_CLASS)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

// Колонка-группа (сортировки проект/дата/приоритет/тип) как drop-цель: свою карточку можно
// бросить на колонку другого проекта (перенос в проект). data=null — цель выключена,
// обычная колонка. Подсветка — только пока тащат то, что сюда можно бросить (highlight).
function GroupDropColumn({
  id,
  data,
  highlight,
  className,
  // Колонка сейчас схлопывается (группа опустела) — её собственный opacity-переход
  // (см. className вызывающего кода) получает data-pf-collapse, иначе на тач он
  // проседает в 0.01ms под pf-no-motion отдельно от grid-схлопывания враппера снаружи.
  // Не ставим атрибут БЕЗУСЛОВНО — иначе он заодно форсировал бы duration и у
  // соседней подсветки броска, которой сейчас это не касается.
  exiting = false,
  children,
}: {
  id: string;
  data: Record<string, unknown> | null;
  highlight: boolean;
  className: string;
  exiting?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id, data: data ?? {}, disabled: data === null });
  return (
    <div
      ref={setNodeRef}
      {...(exiting ? { 'data-pf-collapse': true } : {})}
      className={cn(
        className,
        // Пока тащат подходящую карточку: все колонки-цели получают штрих-намёк, а та, что под
        // курсором, — сплошную рамку и тинт. Одно из двух, не оба разом.
        data !== null && highlight && (isOver ? DROP_OVER_CLASS : DROP_TARGET_CLASS),
      )}
    >
      {children}
    </div>
  );
}

// Фантомная drop-колонка: появляется ПЕРВОЙ в ряду, пока тащат карточку с доски.
// «Другой проект…» / «Другой приоритет…» — дроп открывает соответствующий пикер
// (data {type:'phantom', kind}).
function PhantomDropColumn({
  id,
  kind,
  icon: Icon,
  label,
  hint,
}: {
  id: string;
  kind: 'project' | 'priority';
  icon: LucideIcon;
  label: string;
  hint: string;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: 'phantom', kind } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-40 shrink-0 snap-center snap-always flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-drop-line bg-panel px-3 py-4 text-center transition-[background-color,border-color] duration-200 sm:w-44',
        isOver && 'border-primary bg-drop',
      )}
    >
      <Icon className={cn('size-5', isOver ? 'text-primary' : 'text-muted-foreground')} />
      <span className="text-xs font-medium text-foreground">{label}</span>
      <span className="text-2xs leading-tight text-muted-foreground">{hint}</span>
    </div>
  );
}

// Диалог возврата работы из приёмки: причина обязательна. Кнопка неактивна, пока поле
// пустое, — правило видно сразу, а не после отказа сервера.
// Приложенный к возврату файл + его превью. blob-URL живёт ровно столько, сколько открыт
// диалог, и отзывается при снятии — иначе утечёт (и, как в BUG E, может утащить за собой
// мёртвую ссылку в чужую разметку).
type RejectFile = { id: string; file: File; previewUrl: string | null };

function RejectApprovalDialog({
  task,
  onCancel,
  onSubmit,
}: {
  task: InboxBlockTask | null;
  onCancel: () => void;
  onSubmit: (comment: string, files: readonly File[]) => void;
}): React.ReactElement {
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<RejectFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearFiles = useCallback((): void => {
    setFiles((prev) => {
      prev.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
      return [];
    });
  }, []);

  // Сбрасываем поле и вложения при смене задачи, иначе прошлый текст и чужой скриншот
  // «переезжают» на следующую.
  useEffect(() => {
    setComment('');
    clearFiles();
  }, [task?.id, clearFiles]);

  const addFiles = (list: FileList | readonly File[]): void => {
    const picked = [...list];
    if (picked.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...picked.map((file) => ({
        id: `${file.name}:${file.size}:${file.lastModified}:${prev.length}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      })),
    ]);
  };

  const removeFile = (id: string): void => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  // Ctrl+V со скриншотом: главный способ приложить картинку — прицельно берём только
  // файлы, чтобы обычная вставка текста работала как раньше.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  };

  const trimmed = comment.trim();
  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Вернуть в работу</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Напишите, что доделать. Комментарий появится в задаче, и ответственный получит
          уведомление. Скриншот можно вставить из буфера (Ctrl+V).
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onPaste={handlePaste}
          autoFocus
          rows={4}
          maxLength={4000}
          placeholder="Например: не хватает адаптива на мобиле"
          className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2"
        />

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <div key={f.id} className="group relative">
                {f.previewUrl ? (
                  <img
                    src={f.previewUrl}
                    alt={f.file.name}
                    className="size-16 rounded-md border object-cover"
                  />
                ) : (
                  <div className="grid size-16 place-items-center rounded-md border px-1 text-center text-2xs leading-tight text-muted-foreground">
                    <span className="line-clamp-3 break-all">{f.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  aria-label={`Убрать ${f.file.name}`}
                  className="absolute -end-1.5 -inset-bs-1.5 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-opacity hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
          >
            <Paperclip className="size-4" />
            Файл
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
            <Button
              disabled={trimmed.length === 0}
              onClick={() => onSubmit(trimmed, files.map((f) => f.file))}
            >
              Вернуть в работу
            </Button>
          </div>
        </DialogFooter>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// Полка «На утверждении» (db/150): очередь приёмки руководителя — верхняя часть колонки
// «В работе». Нейтральная зона с фиолетовой меткой (цвет статуса), карточки стопкой; при
// перетаскивании своей готовой работы зона подсвечивается как цель.
function ApprovalShelf({
  items,
  openTaskId = null,
  onOpen,
  onChanged,
  onAccept,
  onReject,
  onWithdraw,
  isApprover,
  currentUserId,
  canDrop,
  dragActive,
  emptyHint,
  narrow = false,
  selecting = false,
  selectedIds,
  onSelectToggle,
  headerEnd,
  className,
}: {
  items: readonly InboxBlockTask[];
  openTaskId?: string | null;
  onOpen: (item: InboxBlockTask) => void;
  onChanged: () => void;
  // Сетевая мутация приёмки. Реджект пробрасывается наверх — ApprovalItemCard сам решает,
  // что делать с уже скрытой локально карточкой (вернуть на место + error-тост).
  onAccept: (item: InboxBlockTask) => Promise<void>;
  onReject: (item: InboxBlockTask) => void;
  // Исполнитель забирает свою задачу обратно («случайно нажал выполнено»).
  onWithdraw: (item: InboxBlockTask) => void;
  // Кнопки решения видит только принимающий. Исполнителю они всё равно не сработали бы:
  // сервер пускает в done лишь руководителя — показывать их значит обещать невозможное.
  isApprover: boolean;
  currentUserId: string | null;
  // Можно ли бросить в полку карточку, которую тащат прямо сейчас. Считает родитель:
  // только он знает, что именно в руке (activeDrag). false — цель погашена.
  canDrop: boolean;
  // Идёт ЛЮБОЙ drag общего контекста — нужен для штрих-намёка «сюда можно»: полка не
  // должна раскрываться только под курсором.
  dragActive: boolean;
  // Чем объяснить пустую полку. На доске сотрудника это «у него нечего принимать», а не
  // общее «сотрудники ещё ничего не сдали» — иначе руководитель читает чужую очередь как свою.
  emptyHint?: string;
  // Узкий экран (телефон): подсказки называют свайп, а не перетаскивание.
  narrow?: boolean;
  // Режим выделения: карточки полки выбираются наравне с карточками колонок, решения
  // приёмки при этом прячем — «Принять» это решение по одной задаче, а не массовое действие.
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  // Кнопка в правом конце шапки (свернуть колонку «В работе»).
  headerEnd?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  // Цель дропа. disabled гасит её целиком: недоступная полка не попадает в коллизии,
  // не подсвечивается и не может принять карточку.
  const { setNodeRef, isOver } = useDroppable({
    id: 'approval-shelf',
    data: { type: 'approval' },
    disabled: !canDrop || selecting,
  });
  // Пустую полку видит и рядовой исполнитель (не только принимающий) — текст по умолчанию
  // объясняет её именно ему: это цель для СВОЕЙ сделанной работы, а не чужая очередь.
  // На телефоне «Вручную» и полка — один раздел без перетаскивания между колонками, поэтому
  // подсказка называет жест, который там работает.
  const defaultEmptyHint = isApprover
    ? 'Здесь появятся задачи, которые сотрудники отметили выполненными. Закрыть их можете только вы.'
    : narrow
      ? 'Сделали задачу из «Вручную» — смахните её вправо, и руководитель примет работу.'
      : 'Готовую задачу перетащите сюда из «Вручную» — её примет руководитель.';
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-[5px] rounded-xl p-[7px] transition-[background-color,outline-color] duration-150',
        canDrop && dragActive && !isOver && DROP_TARGET_CLASS,
        isOver && 'bg-approval-zone outline outline-2 -outline-offset-2 outline-primary',
        className,
      )}
    >
      <div className="flex h-7 items-center gap-1.5 px-[3px] text-ui">
        <span className="pf-tag pf-tag-lg pf-tag-plain pf-tone-approval">
          <ShieldCheck className="size-3.5 shrink-0 text-approval" strokeWidth={2.3} />
          На утверждении
        </span>
        <span className="tabular-nums text-muted-foreground">{items.length}</span>
        {headerEnd}
      </div>
      {items.length === 0 ? (
        <p className="px-1 pbe-1 text-meta leading-snug text-muted-foreground">
          {emptyHint ?? defaultEmptyHint}
        </p>
      ) : (
        items.map((item) => (
          <ApprovalItemCard
            key={item.id}
            item={item}
            open={item.id === openTaskId}
            onOpen={() => onOpen(item)}
            onChanged={onChanged}
            onReject={() => onReject(item)}
            onWithdraw={() => onWithdraw(item)}
            onAccept={onAccept}
            isApprover={isApprover}
            currentUserId={currentUserId}
            selecting={selecting}
            selected={selectedIds?.has(item.id) ?? false}
            {...(onSelectToggle ? { onSelectToggle } : {})}
          />
        ))
      )}
    </div>
  );
}

// Карточка полки «На утверждении»: кнопка «Принять» проигрывает тот же паттерн, что и
// AcceptedCard.completePhase (flash 200мс → collapse 300мс → сеть после), только триггером
// служит явная кнопка, а не жест по самой карточке. Раньше конфетти/тост стреляли сразу
// после ответа сервера, а карточка висела до конца refresh() — казалось, что клик не сработал.
function ApprovalItemCard({
  item,
  open = false,
  onOpen,
  onChanged,
  onReject,
  onWithdraw,
  onAccept,
  isApprover,
  currentUserId,
  selecting = false,
  selected = false,
  onSelectToggle,
}: {
  item: InboxBlockTask;
  open?: boolean;
  onOpen: () => void;
  onChanged: () => void;
  onReject: () => void;
  onWithdraw: () => void;
  onAccept: (item: InboxBlockTask) => Promise<void>;
  isApprover: boolean;
  currentUserId: string | null;
  selecting?: boolean;
  selected?: boolean;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
}): React.ReactElement {
  const { celebrate, forget } = useCompletedToday();
  // Общий движок фаз (useFlashExitPhase, см. AcceptedCard.completePhase ниже и сам хук):
  // в зависимостях его эффекта — только item.id, а onAccept/onError уходят через ref
  // внутри хука. Это важно именно здесь — полка рендерит НЕСКОЛЬКО таких карточек сразу,
  // и refresh() от соседней (свой же после её приёмки, SSE-эхо, mount/visibilitychange)
  // пересобирает approvalTasks и меняет ссылку на item у ВСЕХ смонтированных карточек.
  const { phase, start: startPhase } = useFlashExitPhase(
    item.id,
    () => onAccept(item),
    (err) => {
      // Сеть подвела уже ПОСЛЕ того, как карточка визуально исчезла — возвращаем её
      // и снимаем преждевременно засчитанный праздник (forget пересчитает цифру с
      // сервера, как и в rejectApproval/withdrawApproval).
      forget(item.id);
      toast.error(`Не удалось принять: ${(err as Error).message}`);
    },
  );

  const startAccept = (): void => {
    // Конфетти — в момент клика, не после сети: это и есть мгновенный отклик. Если move
    // всё же упадёт, forget() выше откатит счётчик. start() сам no-op'ает, если фаза уже
    // не idle (кнопка и так disabled, это подстраховка).
    celebrate(item.id);
    startPhase();
  };

  const accepting = phase !== 'idle';

  // Явные кнопки внутри карточки, а не только чекбокс: приёмка — решение, а не отметка.
  // В режиме выделения их прячем: решение принимают по одной задаче, а не пачкой.
  const footer = selecting ? null : isApprover ? (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={startAccept}
        disabled={accepting}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-done-soft px-2.5 text-meta font-semibold text-done-ink transition-colors hover:bg-done-soft-hover disabled:cursor-not-allowed disabled:opacity-70 sm:h-[26px]"
      >
        {accepting ? (
          <Loader2 className="size-3 motion-safe:animate-spin" />
        ) : (
          <Check className="size-3.5" strokeWidth={2.6} />
        )}
        Принять
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={accepting}
        className="inline-flex h-9 items-center rounded-md px-2.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-[26px]"
      >
        Вернуть
      </button>
    </div>
  ) : item.assignee.userId === currentUserId ? (
    // Исполнителю — выход из тупика: отправил по ошибке, забрал обратно.
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      Ждёт решения руководителя
      <button
        type="button"
        onClick={onWithdraw}
        disabled={accepting}
        title="Забрать задачу с утверждения и продолжить работу"
        className="ms-auto inline-flex h-9 items-center rounded-md px-2 text-xs font-semibold text-primary-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 sm:h-6"
      >
        Забрать
      </button>
    </div>
  ) : null;

  return (
    // Тот же коллапс-паттерн, что у AcceptedCard: схлопывание по высоте, соседи по стопке
    // подтягиваются плавно. data-pf-collapse — едет даже при выключенных на тач анимациях
    // (globals.css .pf-no-motion исключение), полка «На утверждении» видна и на телефоне.
    <div
      data-pf-collapse
      className={cn(
        'grid transition-opacity duration-300 ease-out motion-safe:transition-[grid-template-rows,opacity]',
        phase === 'exit' && 'opacity-0',
      )}
      style={{ gridTemplateRows: phase === 'exit' ? '0fr' : '1fr' }}
    >
      <div className={cn('min-h-0 min-w-0', phase === 'exit' ? 'overflow-hidden' : 'overflow-visible')}>
        <div
          className={cn(
            'rounded-lg transition-[box-shadow] duration-200 motion-safe:transition-[transform,box-shadow]',
            phase === 'flash' && 'scale-[1.02] ring-2 ring-done/60',
            phase === 'exit' && 'scale-[0.96]',
          )}
        >
          {/* Свайп вправо на тач-экране — «Принять» (тот же путь, что у кнопки). */}
          <SwipeWrap
            action={
              isApprover && !selecting && !accepting
                ? { label: 'Принять', tone: 'done', onCommit: startAccept }
                : null
            }
          >
            <AcceptedCard
              item={item}
              open={open}
              onOpen={onOpen}
              onChanged={onChanged}
              onDelete={onReject}
              hideQuickActions
              showAssignee
              footer={footer}
              selecting={selecting}
              selected={selected}
              {...(onSelectToggle ? { onSelectToggle } : {})}
            />
          </SwipeWrap>
        </div>
      </div>
    </div>
  );
}

// Полка «Вручную»: нижняя часть колонки «В работе», куда перетаскивают задачи, которыми
// занимаются сами (статус manual — агент такие не берёт). Подсвечивается при наведении
// драга; внизу всегда штриховая подсказка-цель «перетащите сюда».
function InProgressShelf({
  items,
  openTaskId = null,
  onOpen,
  onChanged,
  onDelete,
  renderActions,
  swipe,
  swipeDisabled = false,
  narrow = false,
  flashKey,
  flashItemId,
  selecting = false,
  selectedIds,
  onSelectToggle,
  dragActive = false,
  headerEnd,
  className,
}: {
  items: readonly InboxBlockTask[];
  openTaskId?: string | null;
  onOpen: (item: InboxBlockTask) => void;
  onChanged: () => void;
  onDelete: (item: InboxBlockTask) => void;
  // Быстрые действия карточки «Вручную» (сдать на утверждение, вернуть в очередь) —
  // их собирает родитель: только он знает правила приёмки.
  renderActions: (item: InboxBlockTask) => React.ReactNode;
  // Свайп вправо по карточке на тач-экране — «дальше по процессу» (готово или сдать).
  swipe?: (item: InboxBlockTask) => SwipeAction | null;
  swipeDisabled?: boolean;
  // Узкий экран (телефон): очередь в другом разделе, перетащить сюда из неё нельзя —
  // вместо штриховой цели короткая подсказка, как взять задачу в работу.
  narrow?: boolean;
  // Растёт на каждое взятие задачи в работу — полка проигрывает вспышку.
  flashKey: number;
  // Какую карточку подсветить вместе с полкой (та, что только что приехала).
  flashItemId: string | null;
  // Режим выделения: карточки полки выбираются наравне с колоночными, dnd и точечные
  // действия на это время отключены.
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  // Тащат карточку, которую можно взять в работу, — штрих-намёк «сюда можно».
  dragActive?: boolean;
  headerEnd?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: 'work-in-progress',
    data: { type: 'work', status: 'manual' },
    disabled: selecting,
  });
  const { animations } = useMotion();
  const [flash, setFlash] = useState(false);
  // Убранная из работы/удалённая карточка не выбрасывается из полки мгновенно — держим
  // «призрак» ещё EXIT_MS и схлопываем его CSS-ом (grid 1fr→0fr), чтобы соседи по стопке
  // подтягивались плавно, а не скачком (см. useExitingListItems).
  const displayItems = useExitingListItems(items, (t) => t.id, EXIT_MS);

  useEffect(() => {
    if (flashKey === 0 || !animations) return;
    // Снимаем класс на кадр: без этого повторная вспышка не стартует — класс уже висит.
    setFlash(false);
    const raf = requestAnimationFrame(() => setFlash(true));
    const off = window.setTimeout(() => setFlash(false), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(off);
    };
  }, [flashKey, animations]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative flex flex-col gap-[5px] rounded-xl p-[7px] transition-[background-color,outline-color] duration-150',
        dragActive && !isOver && DROP_TARGET_CLASS,
        isOver && 'bg-manual-zone outline outline-2 -outline-offset-2 outline-primary',
        flash && 'pf-shelf-flash',
        className,
      )}
    >
      <div className="flex h-7 items-center gap-1.5 px-[3px] text-ui">
        {/* Полка — это статус 'manual', и называться должна так же. «В работе» здесь
            было бы вторым смыслом того же слова: в сводках/TG/EOD «В работе» — это
            статус 'in_progress' (задача у воркера), а не «делаю руками». */}
        <span className="pf-tag pf-tag-lg pf-tag-plain pf-tone-manual">
          <ManualIcon className="text-manual" />
          {STATUS_LABEL.manual}
        </span>
        <span className="tabular-nums text-muted-foreground">{items.length}</span>
        {headerEnd}
      </div>
      {displayItems.map(({ item, exiting }) => (
        // Обёртка-коллапс (аналог AcceptedCard/ApprovalItemCard): схлопывается высота,
        // соседи по стопке подтягиваются. overflow — только на exit, иначе на вспышке
        // обрезался бы ring. data-pf-collapse — исключение из pf-no-motion (globals.css).
        <div
          key={item.id}
          data-pf-collapse
          className="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-out"
          style={{ gridTemplateRows: exiting ? '0fr' : '1fr' }}
        >
          <div className={cn('min-h-0 min-w-0', exiting ? 'overflow-hidden' : 'overflow-visible')}>
            <div
              // rounded-lg на обёртке — чтобы вспышка (::after с border-radius: inherit)
              // повторяла скругление карточки. data-pf-collapse — ТОЖЕ здесь: без него на тач
              // pf-no-motion зануляет именно ЭТОТ opacity-transition, и карточка гасла бы
              // рывком, пока пустая коробка вокруг ещё 300мс едет схлопыванием.
              data-pf-collapse
              className={cn(
                'relative rounded-lg transition-opacity duration-200 motion-reduce:transition-none',
                flash && item.id === flashItemId && 'pf-card-flash',
                exiting && 'pointer-events-none opacity-0',
              )}
            >
              {/* Та же ловушка dnd-id, что и у ghost-групп: призрак ещё доигрывает коллапс
                  поверх уже отрисованной живой карточки этой же задачи в другом месте доски.
                  ghost={exiting} суффиксует dnd-id (см. draggableTaskId). */}
              <DraggableTask
                item={item}
                disabled={!item.canModify || exiting}
                ghost={exiting}
                selecting={selecting}
              >
                <SwipeWrap action={exiting || !swipe ? null : swipe(item)} disabled={swipeDisabled}>
                  <AcceptedCard
                    item={item}
                    open={!exiting && item.id === openTaskId}
                    onOpen={() => onOpen(item)}
                    onChanged={onChanged}
                    onDelete={() => onDelete(item)}
                    extraActions={exiting ? null : renderActions(item)}
                    dueOnTop
                    selecting={selecting}
                    selected={selectedIds?.has(item.id) ?? false}
                    {...(onSelectToggle ? { onSelectToggle } : {})}
                  />
                </SwipeWrap>
              </DraggableTask>
            </div>
          </div>
        </div>
      ))}
      {!selecting &&
        (narrow ? (
          items.length === 0 && (
            <p className="px-1 pbe-1 text-meta leading-snug text-muted-foreground">
              Здесь то, чем вы заняты. Возьмите задачу из очереди&nbsp;— свайпом вправо или
              кнопкой «Взять в работу» на карточке.
            </p>
          )
        ) : (
          <div className="grid h-8 place-items-center rounded-[7px] border border-dashed border-drop-line px-2 text-center text-xs text-muted-foreground">
            {items.length === 0 ? 'Перетащите сюда задачу, которой заняты' : 'Перетащите сюда то, чем заняты'}
          </div>
        ))}
    </div>
  );
}

// Обёртка-«ручка» drag'а вокруг карточки задачи. Клик (без сдвига ≥8px) проходит внутрь —
// открывается drawer / тогается чекбокс; долгий тап на мобиле стартует драг (см. sensors).
// disabled — нет прав менять задачу (canModify=false): карточка не таскается.
// selecting — режим выделения: dnd отключён полностью (как в KanbanCard), слушатели не
// навешиваются, чтобы протяжка-выделение не превращалась в перенос карточки.
// Чистое решение dnd-id карточки (тестируется без React/dnd-kit) — вынесено из компонента
// специально под ревью (Important: призрак дублировал dnd-id живой карточки). @dnd-kit/core
// 6.3.1 регистрирует draggableNodes.set(id, ...) БЕЗУСЛОВНО в useDraggable — переданный
// `disabled` его не гейтит, он влияет только на активацию сенсоров. Пока призрак
// (useExitingListItems, exiting:true) держит СТАРЫЙ снимок карточки ещё useExitingListItems'ов
// `ms`, в DOM одновременно живут призрак и уже переехавшая на новое место живая карточка с
// тем же item.id — если призрачный узел стоит в документе ПОСЛЕ живого, его unmount вычищает
// draggableNodes-запись живой карточки, и та молча перестаёт таскаться. Суффикс на ghost-id —
// не «просто не рендерить DraggableTask на призраке», потому что тогда пришлось бы дублировать
// разметку (обёртки/классы/aria) в каждом из двух мест рендера (группы-колонки и InProgressShelf);
// суффикс меняет только то, под каким id узел регистрируется, разметка остаётся одна.
export function draggableTaskId(itemId: string, ghost: boolean): string {
  // id с префиксом: в едином контексте «Входящих» та же задача может одновременно висеть
  // карточкой на доске снизу (useSortable с голым task.id) — двум draggable нельзя делить id.
  // Хендлеры блока id не используют (читают data.item), так что префикс безопасен всегда.
  return ghost ? `assigned-ghost-${itemId}` : `assigned-${itemId}`;
}

function DraggableTask({
  item,
  disabled,
  selecting = false,
  // Карточка — призрак useExitingListItems (уже пропала из живых данных, доигрывает CSS-
  // коллапс). Всегда disabled=true у вызывающих, но id ВСЁ РАВНО должен отличаться от живой
  // карточки с тем же item.id — см. draggableTaskId.
  ghost = false,
  children,
}: {
  item: InboxBlockTask;
  disabled: boolean;
  selecting?: boolean;
  ghost?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: draggableTaskId(item.id, ghost),
    data: { type: 'task', item },
    disabled: disabled || selecting,
  });
  return (
    <div
      ref={setNodeRef}
      {...(selecting ? {} : listeners)}
      {...(selecting ? {} : attributes)}
      className={cn(
        !disabled && !selecting && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30',
      )}
    >
      {children}
    </div>
  );
}

// Участник пространства = drop-цель смены ответственного (дизайн C4: ряд аватаров рядом с
// вкладками). В покое — аватар 30px с карточкой по наведению; фиолетовая точка — у человека
// есть сданная работа. Во время drag'а аватар раскрывается в плитку с именем — большую цель,
// в которую легко попасть (задача 3a36e7e8); под курсором подпись меняется на «Назначить».
// filterActive/onToggleFilter — клик переключает состояние, за которое отвечает вызывающий:
// у руководителя пространства это открытая доска входящих сотрудника, у остальных на
// вкладке «Для всех» — single-фильтр «кому» (спека 2026-07-13).
function UserCube({
  member,
  dragging,
  hasApproval = false,
  filterActive = false,
  onToggleFilter,
  hint,
}: {
  member: SharedMember;
  dragging: boolean;
  hasApproval?: boolean;
  filterActive?: boolean;
  onToggleFilter?: () => void;
  // Что даёт клик — уходит в карточку аватара рядом с «перетащите, чтобы назначить».
  hint?: string;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `user-${member.id}`, data: { type: 'user', member } });
  const label = userLabel(member);
  if (dragging) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-lg border py-1 pe-2.5 ps-1 text-xs transition-[background-color,border-color,box-shadow] duration-200 motion-safe:transition-[background-color,border-color,box-shadow,transform]',
          isOver
            ? 'scale-105 border-primary bg-primary-soft ring-2 ring-inset ring-primary'
            : 'border-dashed border-primary/50 bg-primary-soft',
        )}
      >
        <UserAvatar displayName={member.displayName} avatarUrl={member.avatarUrl} className="size-6 text-2xs" />
        <span className="max-w-[8rem] truncate font-medium">{isOver ? 'Назначить' : label}</span>
      </div>
    );
  }
  // Клик-фильтр доступен только когда проп передан (см. место рендера).
  const clickable = !!onToggleFilter;
  return (
    <div
      ref={setNodeRef}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? filterActive : undefined}
      aria-label={label}
      title={label}
      onClick={clickable ? onToggleFilter : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onToggleFilter?.();
            }
          : undefined
      }
      className={cn(
        'flex w-16 shrink-0 flex-col items-center gap-1 rounded-lg transition-shadow',
        clickable && 'cursor-pointer active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        filterActive && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      <span className="relative inline-flex">
        <UserAvatarHover
          displayName={label}
          avatarUrl={member.avatarUrl}
          subtitle={`участник пространства. Перетащите сюда задачу, чтобы назначить${
            hint ? `. ${hint}` : ''
          }`}
          triggerClassName={cn('size-9 text-2xs sm:size-[30px]', clickable && 'cursor-pointer')}
        />
        {hasApproval && (
          <span
            aria-hidden
            className="absolute -end-0.5 -inset-be-0.5 size-2.5 rounded-full bg-approval ring-2 ring-background"
          />
        )}
      </span>
      <span className="block max-w-full break-words text-center text-2xs text-muted-foreground">{label}</span>
    </div>
  );
}

// Своя ава = drop-цель «забрать себе» — первая в ряду людей. В покое — обычный аватар;
// во время drag'а — плитка «Себе», под курсором — «Забрать себе». Дроп сюда идёт по тому же
// type:'user' с member.id === user.id (см. handleDragEnd).
function SelfDropAvatar({
  user,
  dragging,
}: {
  user: { id: string; displayName: string; email: string; avatarUrl?: string | null };
  dragging: boolean;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `user-${user.id}`,
    data: {
      type: 'user',
      member: { id: user.id, displayName: userLabel(user), email: user.email, avatarUrl: user.avatarUrl ?? null },
    },
  });
  if (dragging) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-lg border py-1 pe-2.5 ps-1 text-xs transition-[background-color,border-color,box-shadow] duration-200 motion-safe:transition-[background-color,border-color,box-shadow,transform]',
          isOver
            ? 'scale-105 border-primary bg-primary-soft ring-2 ring-inset ring-primary'
            : 'border-dashed border-primary/50 bg-primary-soft',
        )}
      >
        <UserAvatar displayName={user.displayName} avatarUrl={user.avatarUrl} className="size-6 text-2xs" />
        <span className="whitespace-nowrap font-medium">{isOver ? 'Забрать себе' : 'Себе'}</span>
      </div>
    );
  }
  return (
    <div ref={setNodeRef} className="flex w-16 shrink-0 flex-col items-center gap-1" title={userLabel(user)}>
      <UserAvatarHover
        displayName={userLabel(user)}
        avatarUrl={user.avatarUrl}
        you
        subtitle="перетащите сюда задачу, чтобы забрать себе"
        triggerClassName="size-9 text-2xs sm:size-[30px]"
      />
      <span className="block max-w-full break-words text-center text-2xs text-muted-foreground">{userLabel(user)}</span>
    </div>
  );
}

// Всплывашка выбора срока при дропе в «Будущее»: неделя / до конца месяца / конкретный день.
// Отмена (закрытие) — ничего не меняем, карточка остаётся где была. От задачи ей ничего не
// нужно (только open/onPick).
export function FutureDeadlineDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (deadline: string) => void;
}): React.ReactElement {
  const dateRef = useRef<HTMLInputElement>(null);
  const now = new Date();
  const openNativePicker = (): void => {
    const inp = dateRef.current;
    if (!inp) return;
    if (typeof inp.showPicker === 'function') {
      try {
        inp.showPicker();
      } catch {
        inp.focus();
      }
    } else {
      inp.focus();
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Срок на будущее</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Button
            variant="outline"
            className="justify-start gap-2"
            onClick={() => onPick(endOfWeekYmd(now))}
          >
            <CalendarClock className="size-4" />
            До конца недели
          </Button>
          <Button
            variant="outline"
            className="justify-start gap-2"
            onClick={() => onPick(endOfMonthYmd(now))}
          >
            <CalendarRange className="size-4" />
            До конца месяца
          </Button>
          <Button variant="outline" className="justify-start gap-2" onClick={openNativePicker}>
            <CalendarDays className="size-4" />
            Выбрать день…
          </Button>
          <input
            ref={dateRef}
            type="date"
            // Минимум — завтра: колонка «Будущее» = дедлайн строго позже сегодня.
            min={ymd(startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)))}
            onChange={(e) => e.target.value && onPick(e.target.value)}
            className="sr-only"
            tabIndex={-1}
            aria-label="Выбрать день срока"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Один участник в диалоге смены ответственного: подпись-роль + аватар с hover-карточкой (наведи —
// увидишь человека) + имя. highlight — получатель (primary-ринг, имя жирнее).
function AssigneePerson({
  name,
  avatarUrl,
  label,
  highlight = false,
}: {
  name: string;
  avatarUrl?: string | null;
  label: string;
  highlight?: boolean;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span className="text-2xs font-medium text-muted-foreground/70">
        {label}
      </span>
      <UserAvatarHover
        displayName={name}
        avatarUrl={avatarUrl}
        subtitle="участник пространства"
        triggerClassName={cn(
          'size-11 text-sm',
          highlight && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background',
        )}
      />
      <span
        className={cn(
          'max-w-[8rem] truncate text-xs',
          highlight ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {name}
      </span>
    </div>
  );
}

// Подтверждение смены ответственного дропом на кубик участника. Единый диалог
// Название задачи + переход «текущий → новый ответственный» с аватарами
// (from=null — новое назначение, показываем только ответственного). Кнопки блокируются на время запроса.
export function AssigneeConfirmDialog({
  open,
  taskTitle,
  from,
  to,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  taskTitle: string;
  from: { name: string; avatarUrl?: string | null } | null;
  to: { name: string; avatarUrl?: string | null };
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-sm gap-4 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Сменить ответственного?</DialogTitle>
        </DialogHeader>
        <p className="line-clamp-2 text-sm text-muted-foreground">{taskTitle || 'Задача'}</p>
        {/* «Сейчас у» → «Кому» с аватарами: наведи на аву — карточка человека. Свежее
            назначение (from=null) — только получатель. */}
        <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/30 px-2 py-3">
          {from ? (
            <>
              <AssigneePerson name={from.name} avatarUrl={from.avatarUrl} label="Сейчас" />
              <ArrowRight className="size-4 shrink-0 self-center text-muted-foreground/50" />
              <AssigneePerson name={to.name} avatarUrl={to.avatarUrl} label="Новый" highlight />
            </>
          ) : (
            <AssigneePerson name={to.name} avatarUrl={to.avatarUrl} label="Ответственный" highlight />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Отмена
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            Назначить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Вкладки блока ответственных: «Мои» / «Все» — переключатель в стиле C4: серая
// подложка, выбранная вкладка — белая плашка (в тёмной теме — приподнятая графитовая).
function AssigneeTabs({
  tab,
  onChange,
  toMeCount,
  byMeCount,
  className,
}: {
  className?: string;
  tab: AssigneeTab;
  onChange: (t: AssigneeTab) => void;
  toMeCount: number;
  byMeCount: number;
}): React.ReactElement {
  return (
    // Без role=tablist/tab: полный ARIA-паттерн табов требует roving tabindex и
    // стрелочной навигации — вместо ложной семантики честные toggle-кнопки (aria-pressed).
    <div
      role="group"
      aria-label="Чьи задачи"
      className={cn(
        'flex min-w-0 items-center rounded-lg bg-foreground/[0.06] p-0.5 dark:border dark:border-border dark:bg-panel',
        className,
      )}
    >
      <TabButton
        active={tab === 'toMe'}
        label="Мои"
        count={toMeCount}
        onClick={() => onChange('toMe')}
      />
      <TabButton
        active={tab === 'byMe'}
        label="Все"
        count={byMeCount}
        onClick={() => onChange('byMe')}
      />
    </div>
  );
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // min-w-0 — на 320px подпись ужимается truncate'ом, а не вылезает из бокса.
        'inline-flex h-11 min-w-0 items-center justify-center gap-1 rounded-md px-2 text-ui transition-colors md:h-7',
        active
          ? 'bg-background font-semibold text-foreground shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none'
          : 'font-medium text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

// #2: единая кнопка «Фильтры» «Входящих» — поповер, куда собраны ВСЕ контролы шапки, чтобы
// не «летали» по строке: сортировка блока (когда есть задачи), тумблер «скрыть выполненные»
// (всегда — действует и на доску ниже) и фильтры Ответственный/Проект (только вкладка «Другим»).
// Инлайн-чипы/строки без вложенного DropdownMenu-портала — выбор не закрывает поповер.
function InboxFiltersPopover({
  showSort,
  showFilters,
  grouping,
  onGroupingChange,
  hideDone,
  onHideDoneChange,
  showHidePersonal,
  hidePersonal,
  onHidePersonalChange,
  options,
  to,
  project,
  onTo,
  onProject,
  onResetFilters,
}: {
  showSort: boolean;
  showFilters: boolean;
  grouping: AssignedGrouping;
  onGroupingChange: (g: AssignedGrouping) => void;
  hideDone: boolean;
  onHideDoneChange?: (v: boolean) => void;
  showHidePersonal: boolean;
  hidePersonal: boolean;
  onHidePersonalChange: (v: boolean) => void;
  options: {
    to: { id: string; name: string }[];
    projects: { id: string; name: string }[];
  };
  to: string | null;
  project: string | null;
  onTo: (v: string | null) => void;
  onProject: (v: string | null) => void;
  onResetFilters: () => void;
}): React.ReactElement {
  const activeFilterCount = showFilters ? [to, project].filter((v) => v !== null).length : 0;
  // Бейдж на кнопке = сколько «нестандартного» включено (фильтры + скрытие выполненных),
  // чтобы было видно активность, не открывая поповер. Сортировка — выбор, не «активный фильтр».
  const badgeCount =
    activeFilterCount + (hideDone ? 1 : 0) + (showHidePersonal && hidePersonal ? 1 : 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Фильтры"
          className={cn(
            'inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-ui text-muted-foreground transition-colors hover:bg-hover hover:text-foreground md:h-8 md:min-w-8',
            badgeCount > 0 && 'bg-hover text-foreground',
          )}
        >
          <Filter className="size-3.5" />
          <span className="hidden sm:inline">Фильтры</span>
          {badgeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-soft px-1 text-[10px] font-semibold tabular-nums text-primary-ink">
              {badgeCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="max-h-[70vh] overflow-y-auto py-1">
          {/* Скрыть выполненные — всегда (действует и на доску ниже). */}
          <div className="px-1">
            <HideDoneRow value={hideDone} onChange={onHideDoneChange} />
            {/* Скрыть личные — только вкладка «Другим» (личные доски коллег). */}
            {showHidePersonal && (
              <HidePersonalRow value={hidePersonal} onChange={onHidePersonalChange} />
            )}
          </div>

          {/* Сортировка верхнего личного блока — когда есть задачи (иначе вкладок нет). */}
          {showSort && (
            <div className="mbs-1 border-bs px-2 pbe-1 pbs-2">
              <div className="mbe-1.5 flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
                <ListFilter className="size-3 shrink-0" />
                Сортировка
              </div>
              <div className="flex flex-wrap gap-1">
                {ASSIGNED_GROUPINGS.map((g) => (
                  <FilterChip key={g} active={grouping === g} onClick={() => onGroupingChange(g)}>
                    {ASSIGNED_GROUPING_LABELS[g]}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}

          {/* Фильтры по ответственному и проекту — только вкладка «Другим». */}
          {showFilters && (
            <>
              <div className="mbs-1 flex items-center justify-between border-bs px-3 pbe-1 pbs-2">
                <span className="text-xs font-semibold text-muted-foreground">Фильтры</span>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={onResetFilters}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                  >
                    <X className="size-3" />
                    Сбросить
                  </button>
                )}
              </div>
              <InboxFilterSection
                icon={Users}
                label="Ответственный"
                options={options.to}
                value={to}
                onChange={onTo}
              />
              <InboxFilterSection
                icon={FolderKanban}
                label="Проект"
                options={options.projects}
                value={project}
                onChange={onProject}
              />
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Строка-тумблер «скрыть/показать личные» — только вкладка «Другим», где к делегированным
// задачам примешиваются личные доски коллег. Зеркалит вёрстку HideDoneRow.
function HidePersonalRow({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      <InboxIcon className="size-3.5 shrink-0" />
      <span className="flex-1 text-start">Скрыть личные</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-2xs font-medium',
          value ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-muted-foreground',
        )}
      >
        {value ? 'скрыты' : 'видны'}
      </span>
    </button>
  );
}

// Строка-тумблер «скрыть/показать выполненные» внутри поповера «Фильтры».
function HideDoneRow({
  value,
  onChange,
}: {
  value: boolean;
  onChange?: (v: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!value)}
      aria-pressed={value}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {value ? (
        <EyeOff className="size-3.5 shrink-0" />
      ) : (
        <Eye className="size-3.5 shrink-0" />
      )}
      <span className="flex-1 text-start">Скрыть выполненные</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-2xs font-medium',
          value ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-muted-foreground',
        )}
      >
        {value ? 'скрыты' : 'видны'}
      </span>
    </button>
  );
}

// Секция поповера фильтров: заголовок + чипы значений («Все» + опции). Активный чип — акцент.
function InboxFilterSection({
  icon: Icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  options: { id: string; name: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}): React.ReactElement {
  return (
    <div className="px-2 py-1.5">
      <div className="mbe-1.5 flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        <FilterChip active={value === null} onClick={() => onChange(null)}>
          Все
        </FilterChip>
        {options.map((o) => (
          <FilterChip key={o.id} active={value === o.id} onClick={() => onChange(o.id)}>
            {o.name}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
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
      aria-pressed={active}
      className={cn(
        'max-w-[12rem] truncate rounded-md border px-2 py-0.5 text-xs transition-colors',
        active
          ? 'border-primary bg-primary-soft font-medium text-foreground'
          : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
      )}
    >
      {children}
    </button>
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

// Иконка колонки личного канбана по времени: без срока / на сегодня / будущее.
function TimeBucketIcon({ bucket }: { bucket: string }): React.ReactElement {
  if (bucket === 'none') return <CalendarOff className="size-3.5 shrink-0" />;
  if (bucket === 'future') return <CalendarDays className="size-3.5 shrink-0" />;
  return <CalendarClock className="size-3.5 shrink-0" />;
}

// === Карточки канбана (колонка = группа) ===
// Карточка задачи «Входящих» (дизайн C4): белая плашка с кольцом-тенью (в тёмной — графит с
// линией). Сверху — метка проекта (и автор работы на полке приёмки, срок — у «Вручную»),
// заголовок 13.5px, первая строка описания вторичным цветом, снизу — срок и счётчики.
// Быстрые действия — плашкой в правом верхнем углу по наведению; на тач-экранах — рядом
// снизу. Клик открывает drawer, ПКМ и Ctrl+клик — «выполнено».
function AcceptedCard({
  item,
  open = false,
  onOpen,
  onChanged,
  onDelete,
  showCreatedAt = false,
  hideProjectLabel = false,
  selecting = false,
  selected = false,
  onSelectToggle,
  hideQuickActions = false,
  extraActions = null,
  footer = null,
  showAssignee = false,
  dueOnTop = false,
}: {
  item: InboxBlockTask;
  open?: boolean;
  onOpen: () => void;
  onChanged: () => void;
  onDelete: () => void;
  // При сортировке «по дате создания» показываем дату создания в нижней строке.
  showCreatedAt?: boolean;
  // При сортировке «по проекту» колонка уже названа проектом — метка на карточке не нужна.
  hideProjectLabel?: boolean;
  // Режим выделения: клик тогает выбор вместо открытия дравера, действия карточки скрыты.
  selecting?: boolean;
  selected?: boolean;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  // Приёмка (db/150): в полке утверждения действия живут в явных кнопках «Принять» /
  // «Вернуть» (footer), поэтому плашка «готово/удалить» только путает.
  hideQuickActions?: boolean;
  // Действия перед «готово/удалить» в плашке: «Взять в работу», «Сдать на утверждение»…
  extraActions?: React.ReactNode;
  // Нижняя часть карточки (кнопки решения на полке приёмки).
  footer?: React.ReactNode;
  // Аватар и имя ответственного в верхней строке — на полке приёмки «чья это работа».
  showAssignee?: boolean;
  // Срок — в верхней строке справа (полка «Вручную»), а не внизу.
  dueOnTop?: boolean;
}): React.ReactElement {
  const isDone = item.status === 'done';
  const { taskRepository } = useContainer();
  const { user: currentUser } = useCurrentUser();
  const { celebrate } = useCompletedToday();
  const { isUnread } = useUnreadTasks();
  // ПКМ по карточке = «выполнить»: карточка мигает зелёным, затем плавно схлопывается и
  // исчезает, и только после анимации коммитим move→done (визуально её уже нет — рефетч
  // ниже не даёт скачка). Фазы: idle → flash (вспышка) → exit (коллапс+затухание). Движок
  // фаз — общий хук useFlashExitPhase (см. его же в ApprovalItemCard выше): в зависимостях
  // его внутреннего эффекта только item.id, а не сторонние onChanged/onCommit — иначе
  // посторонний refresh() посреди анимации сбрасывал бы уже тикающий таймер.
  // Держать ли серую вуаль во время анимации. true только для Ctrl-пути, где она уже видна
  // под курсором: снять её на клике — из-под неё на миг проступит текст. Для ПКМ остаётся
  // false, иначе вуаль резко «выпрыгнет» на пустом месте.
  const [completeVeiled, setCompleteVeiled] = useState(false);
  const { phase: completePhase, start: startCompletePhase } = useFlashExitPhase(
    item.id,
    async () => {
      await taskRepository.move(item.projectId, item.id, {
        targetStatus: 'done',
        beforeTaskId: null,
        afterTaskId: null,
      });
      celebrate(item.id);
      onChanged();
    },
    (err) => {
      setCompleteVeiled(false);
      toast.error(`Не удалось выполнить: ${(err as Error).message}`);
    },
  );

  // Единая точка запуска для обоих жестов: withVeil — оставлять ли серую вуаль на анимацию.
  const startComplete = (withVeil: boolean): void => {
    setCompleteVeiled(withVeil);
    startCompletePhase();
  };

  const completeByContextMenu = (e: React.MouseEvent): void => {
    // Только для своих задач, не в режиме выделения и не по уже выполненной — иначе
    // отдаём браузерное контекстное меню (preventDefault не зовём).
    if (selecting || !item.canModify || isDone || completePhase !== 'idle') return;
    e.preventDefault();
    startComplete(false);
  };

  // Второй способ — Ctrl/⌘ + ЛКМ. При зажатом модификаторе на наведённой карточке
  // показываем серый оверлей с галочкой (аффорданс), а клик по ней — выполняет.
  const ctrlHeld = useCtrlOrMetaHeld();
  const completeArmed = ctrlHeld && item.canModify && !isDone && !selecting && completePhase === 'idle';
  const completing = completePhase !== 'idle';

  // Выделять можно ЛЮБУЮ карточку, в том числе без прав на изменение: пользователь хочет
  // собирать пачку свободно. Действие по такой задаче честно попадёт в «не удалось» —
  // это лучше, чем карточка, которая молча не откликается на клик.
  const selectable = selecting;
  // Заголовок/тело как на досках проектов: 1-я строка — заголовок, тело — первая строка
  // описания вторичным цветом.
  const { title, body } = splitTitleBody(item.description ?? '');
  // Метка проекта. Чужие личные входящие подписываем владельцем («Личные · Денис Волков»):
  // без имени задача выглядела бы своей, хотя запись живёт у другого человека.
  const foreignInboxOwner =
    item.isInbox && item.inboxOwner && item.inboxOwner.userId !== currentUser?.id
      ? item.inboxOwner.displayName
      : null;
  // Мне здесь адресовали комментарий, а я не ответил — бейдж «Ответить» первым в мете.
  const question = useAwaitingReply().questionFor(item.id);
  const projectLabel = item.isInbox
    ? foreignInboxOwner
      ? `Личные · ${foreignInboxOwner}`
      : 'Личные'
    : item.projectName;

  const showActions = !selecting && !hideQuickActions;
  // Кнопки действий: свои (extraActions) + «выполнено» + «удалить». Рендерятся в ДВУХ
  // раскладках: десктоп — плавающая плашка по hover, мобила — ряд под текстом.
  const actions = showActions ? (
    <>
      {extraActions}
      <InboxCheckbox
        task={item}
        lastDoneTaskId={null}
        lastTodoTaskId={null}
        onChanged={onChanged}
        disabled={!item.canModify}
        variant="toolbar"
      />
      {/* Удаление показываем только при правах — кнопка, которая заведомо упадёт, хуже её
          отсутствия. Чекбокс же остаётся видимым (disabled) как индикатор статуса. */}
      {item.canModify && (
        <QuickAction
          label="Удалить"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </QuickAction>
      )}
    </>
  ) : null;

  const deadline = item.deadline ? (
    <DeadlineBadge deadline={item.deadline} status={item.status} />
  ) : null;
  const showTopMeta = showAssignee || !hideProjectLabel || (dueOnTop && deadline !== null);
  const assigneeIsMe = item.assignee.userId === currentUser?.id;
  // Нижняя строка — только то, что есть: срок, приоритет, режим агента, счётчики,
  // ответственный (если не вы). Пустой строки не бывает.
  const bottomMeta = [
    question ? <AwaitingReplyBadge key="reply" question={question} /> : null,
    !dueOnTop && deadline ? <span key="due">{deadline}</span> : null,
    item.priority !== null && item.priority !== undefined ? (
      <PriorityBadge key="priority" priority={item.priority} />
    ) : null,
    item.ralphMode !== 'normal' ? <RalphModeBadge key="ralph" mode={item.ralphMode} /> : null,
    (item.commentCount ?? 0) > 0 ? (
      <span key="comments" className="flex shrink-0 items-center gap-1 whitespace-nowrap" title="Комментарии">
        <MessageSquare className="size-3" />
        {item.commentCount}
      </span>
    ) : null,
    (item.attachmentCount ?? 0) > 0 ? (
      <span key="files" className="flex shrink-0 items-center gap-1 whitespace-nowrap" title="Вложения">
        <ImageIcon className="size-3" />
        {item.attachmentCount}
      </span>
    ) : null,
    (item.commitCount ?? 0) > 0 ? (
      <span key="commits" className="flex shrink-0 items-center gap-1 whitespace-nowrap" title="Коммиты">
        <GitCommit className="size-3" />
        {item.commitCount}
      </span>
    ) : null,
    showCreatedAt ? (
      <span key="created" className="flex shrink-0 items-center gap-1 whitespace-nowrap" title="Создана">
        <CalendarDays className="size-3" />
        {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(item.createdAt)}
      </span>
    ) : null,
    !showAssignee && !assigneeIsMe ? (
      <span key="assignee" className="ms-auto flex shrink-0 items-center">
        <AssigneeBadge assignee={item.assignee} />
      </span>
    ) : null,
  ].filter(Boolean);

  return (
    // Обёртка-аниматор: плавный коллапс высоты (grid 1fr→0fr) + затухание при «выполнено».
    // overflow скрываем ТОЛЬКО на фазе exit — иначе на вспышке обрезался бы зелёный ring.
    // data-pf-collapse — исключение из pf-no-motion (globals.css): едет даже когда анимации
    // на тач выключены по умолчанию (MotionProvider), иначе на телефоне карточка исчезала бы
    // скачком и соседи снизу прыгали бы на её место без анимации.
    <div
      data-pf-collapse
      className={cn(
        // grid-cols-[minmax(0,1fr)] — не косметика: у единственной неявной колонки размер
        // `auto`, а её минимум = min-content содержимого. Карточка с неразрывным куском шире
        // колонки (длинное имя проекта, ряд nowrap-бейджей на узком экране) раздвигала трек.
        'grid grid-cols-[minmax(0,1fr)] transition-opacity duration-300 ease-out motion-safe:transition-[grid-template-rows,opacity]',
        completePhase === 'exit' && 'opacity-0',
      )}
      style={{ gridTemplateRows: completePhase === 'exit' ? '0fr' : '1fr' }}
    >
      {/* min-w-0 к min-h-0: у grid-элемента min-width по умолчанию auto (= min-content) и
          без сброса он сам распирает колонку — второй замок на ту же дверь. */}
      <div className={cn('min-h-0 min-w-0', completePhase === 'exit' ? 'overflow-hidden' : 'overflow-visible')}>
        <div
          // data-pf-task-id — по нему протяжка резолвит карточку под указателем (useDragSelect).
          data-pf-task-id={item.id}
          data-pf-task-open={open || undefined}
          aria-current={open ? 'true' : undefined}
          // Вне режима выделения role/tabIndex приходят от dnd-kit на обёртке DraggableTask —
          // второй кнопки внутри кнопки не создаём. В режиме выделения атрибуты сняты, и
          // фокусируемость с ролью возвращает карточка.
          role={selecting ? 'button' : undefined}
          tabIndex={selecting ? 0 : undefined}
          aria-pressed={selectable ? selected : undefined}
          onContextMenu={completeByContextMenu}
          className={cn(
            'group relative flex cursor-pointer select-none flex-col gap-1 rounded-lg bg-card px-2.5 py-[7px] text-card-foreground shadow-card transition-[box-shadow,background-color] duration-150 hover:shadow-card-hover',
            !open && 'dark:hover:bg-card-hover',
            // Непрочитанная: синий неон по контуру. До состояний выбора/вспышки — те
            // временные и должны перебивать подсветку.
            !open && !selecting && item.priority !== 1 && isUnread(item.id) && 'pf-unread',
            // Срочная: красное свечение. Перебивает синее — «сделай сейчас» важнее «посмотри».
            !open && !selecting && item.priority === 1 && 'pf-urgent',
            selected && 'ring-2 ring-primary',
            open && completePhase === 'idle' && OPEN_TASK_CARD_CLASS,
            // Вспышка «выполнено»: мягкий зелёный + лёгкий pop.
            completePhase === 'flash' && 'scale-[1.02] bg-done-soft ring-2 ring-done/60',
            // Уход: сжимаемся внутрь, обёртка коллапсит высоту и гасит opacity.
            completePhase === 'exit' && 'scale-[0.96]',
          )}
          onClick={(e) => {
            if (selecting) {
              if (selectable) {
                onSelectToggle?.(item.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
              }
              return;
            }
            // Ctrl/⌘ + ЛКМ = выполнить (вместо открытия дравера).
            if ((e.ctrlKey || e.metaKey) && item.canModify && !isDone && completePhase === 'idle') {
              e.preventDefault();
              startComplete(true);
              return;
            }
            onOpen();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (selecting) {
              if (selectable) {
                onSelectToggle?.(item.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
              }
              return;
            }
            onOpen();
          }}
        >
          {/* Аффорданс «Ctrl+клик = выполнить»: серый оверлей с зелёной галочкой поверх
              карточки, виден только при зажатом Ctrl и наведении. pointer-events-none — клик
              идёт в карточку. */}
          {(completeArmed || (completing && completeVeiled)) && (
            <div
              className={cn(
                'pointer-events-none absolute inset-0 z-30 items-center justify-center rounded-lg bg-foreground/15 backdrop-blur-[1px] transition-opacity duration-150 dark:bg-black/40',
                // Во время выполнения вуаль видна безусловно — не завязана на hover: при коллапсе
                // карточка уезжает из-под курсора, и hover-условие сняло бы её на полпути.
                completing
                  ? 'flex opacity-100'
                  : 'hidden opacity-0 group-hover:flex group-hover:opacity-100',
              )}
            >
              <span
                className={cn(
                  'flex size-9 items-center justify-center rounded-full bg-done text-background shadow-float ring-2 ring-background/70 duration-200 motion-safe:transition-transform',
                  // Галочка на вспышке слегка «подпрыгивает», на уходе — сжимается с карточкой.
                  completePhase === 'flash' && 'scale-110',
                  completePhase === 'exit' && 'scale-90',
                )}
              >
                <Check className="size-5" strokeWidth={3} />
              </span>
            </div>
          )}

          {showTopMeta && (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {showAssignee && (
                <span className="flex min-w-0 shrink items-center gap-1.5">
                  <UserAvatar
                    displayName={item.assignee.displayName}
                    avatarUrl={item.assignee.avatarUrl}
                    className="size-[18px] text-[8.5px]"
                  />
                  <span className="truncate">{item.assignee.displayName}</span>
                </span>
              )}
              {!hideProjectLabel && (
                <span
                  className={cn('pf-tag min-w-0', projectToneClass(item.projectId, item.isInbox))}
                  title={projectLabel}
                >
                  <span className="truncate">{projectLabel}</span>
                </span>
              )}
              {dueOnTop && deadline && <span className="ms-auto shrink-0">{deadline}</span>}
            </div>
          )}

          <div className="min-w-0">
            <WorkerActivityBadge projectId={item.projectId} taskId={item.id} />
            {item.description?.trim() ? (
              <>
                {/* Моб: весь текст задачи; десктоп — до трёх строк заголовка и строка тела. */}
                <div
                  className={cn(
                    'line-clamp-3 max-sm:line-clamp-none',
                    isDone && 'text-muted-foreground line-through decoration-muted-foreground/40',
                  )}
                >
                  <TaskTitleText title={title} className={taskCardTitleClass(title)} authoredBold />
                </div>
                {/* Тело — одна строка с многоточием (на телефоне до четырёх): высота в em от
                    своего 12.5px, поэтому вторая строка не выглядывает наполовину. */}
                {body.trim() && (
                  <div className="max-h-[1.42em] overflow-hidden text-meta max-sm:max-h-[5.68em]">
                    <Markdown
                      className={cn(TASK_CARD_BODY_CLASS, '[&>*]:line-clamp-1 max-sm:[&>*]:line-clamp-4')}
                    >
                      {body}
                    </Markdown>
                  </div>
                )}
              </>
            ) : (
              <p className="text-task text-muted-foreground">—</p>
            )}
          </div>

          {/* Нижняя строка. На телефоне с действиями — одна строка «мета слева, кнопки
              справа» (ниже), чтобы карточка не росла на отдельный ряд кнопок. */}
          {bottomMeta.length > 0 && (
            <div
              className={cn(
                'min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pbs-0.5 text-2xs text-muted-foreground',
                showActions ? 'hidden sm:flex' : 'flex',
              )}
            >
              {bottomMeta}
            </div>
          )}

          {footer && (
            <div
              className="relative z-[1] pbs-0.5"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {footer}
            </div>
          )}

          {/* Быстрые действия — ДЕСКТОП: плашка в правом верхнем углу по hover/фокусу. */}
          {showActions && (
            <div
              className="pointer-events-none absolute end-[5px] inset-bs-[5px] z-20 hidden items-center gap-px rounded-[7px] bg-raised p-0.5 opacity-0 shadow-[0_2px_6px_oklch(16.84%_0_none/0.08)] ring-1 ring-border transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 sm:flex dark:shadow-none"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          )}
          {/* Быстрые действия — МОБИЛА: в одной строке с мета (всегда видны, крупные). */}
          {showActions && (
            <div className="flex items-center gap-2 sm:hidden">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                {bottomMeta}
              </div>
              {/* Тач-размер 40px у всех кнопок ряда (как в мобильном ряду карточки доски):
                  в 32px пальцем промахивались. */}
              <div
                className="flex shrink-0 items-center gap-0.5 [&>button]:size-10 [&>button]:rounded-md [&_svg]:size-4"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                {actions}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
