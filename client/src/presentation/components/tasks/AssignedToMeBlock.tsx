import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { STATUS_LABEL } from './statusLabels';
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
  Plus,
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
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { useFlashExitPhase, EXIT_MS } from '@/presentation/hooks/useFlashExitPhase';
import { useExitingListItems } from '@/presentation/hooks/useExitingListItems';
import { useUnreadTasks } from '@/presentation/hooks/UnreadTasksProvider';
import { useFocusedInbox } from '@/presentation/hooks/FocusedInboxProvider';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useSpotlightTask } from '@/presentation/hooks/useSpotlightTask';
import {
  REALTIME_CONNECTED_EVENT,
  TASK_CHANGED_EVENT,
} from '@/presentation/hooks/useNotificationStream';
import { useCtrlOrMetaHeld } from '@/presentation/hooks/useCtrlOrMetaHeld';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import type { Task, RalphMode, TaskPriority } from '@/domain/task/Task';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import {
  ASSIGNED_GROUPING_LABELS,
  ASSIGNED_GROUPINGS,
  DEFAULT_ASSIGNED_GROUPING,
  type AssignedGrouping,
} from '@/domain/user/UiPrefs';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';
import type { SharedMember } from '@/application/project/ProjectRepository';
import {
  endOfMonthYmd,
  endOfWeekYmd,
  groupAssignedByTime,
  groupAssignedTasks,
  startOfDay,
  ymd,
  type AssigneeDirection,
} from './assignedGrouping';
import { COLUMN_SCROLL_CLASS, ColumnPreviewList } from './ColumnPreview';
import { SyncedStickyScrollbar } from './SyncedStickyScrollbar';
import { InlineNewCard } from './KanbanColumn';
import { BulkActionBar } from './BulkActionBar';
import {
  nextAnchor,
  nextSelection,
  type SelectModifiers,
} from './selection/selectionReducer';
import { useDragSelect } from './selection/useDragSelect';
import { useCrossProjectBulkActions } from '@/presentation/hooks/useCrossProjectBulkActions';
import { TaskTitleText } from './TaskTitleText';
import { splitTitleBody, plainTaskTitle } from '@/lib/taskTitleBody';
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';
import { InboxCheckbox } from './InboxCheckbox';
import { AssigneeBadge } from './AssigneeBadge';
import { PriorityBadge } from './PriorityBadge';
import { DeadlineBadge } from './DeadlineBadge';
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
  type AssignedInboxBlockTask,
  type InboxBlockTask,
} from './inboxBlockTasks';

type Props = {
  // Снимок именно нижней inbox-доски. null = доска ещё не закончила первую загрузку.
  // Свои задачи виртуально зеркалятся в верхнюю личную колонку без дублирования в БД.
  boardTasks: readonly Task[] | null;
  inboxProjectId: string;
  // Колбэк после смены ответственного/toggle — InboxPage перефетчит доску ниже.
  onChanged?: () => void;
  // Режим отображения (как у страницы «Входящие»): 'kanban' — группы становятся колонками
  // канбана, 'list' — плоский список с заголовками групп.
  // DOM-узел в шапке страницы, куда портализуются фильтры (от/кому/проект) + «Сортировка».
  // null (нет слота) → рендерим их на месте, в шапке блока (фолбэк).
  toolbarSlot?: HTMLElement | null;
  // Скрыть выполненные (status='done'). Действует и на этот блок, и на доску ниже — один
  // тумблер на страницу (persist в localStorage у InboxPage). Тумблер живёт внутри кнопки
  // «Фильтры» этого блока, поэтому нужен и сеттер.
  hideDone?: boolean;
  onHideDoneChange?: (v: boolean) => void;
  // Full-bleed классы (как у доски проекта): в kanban ряд колонок выносится за паддинг
  // страницы, чтобы отступы от краёв были такими же, как в проектах.
  bleedNegClass?: string;
  bleedPadClass?: string;
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
  toolbarSlot = null,
  hideDone = false,
  onHideDoneChange,
  bleedNegClass = '',
  bleedPadClass = '',
  selectionActive = false,
  onSelectionActiveChange,
}: Props): React.ReactElement | null {
  const { taskAssigneeRepository, taskRepository, userRepository, projectRepository } =
    useContainer();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { forget } = useCompletedToday();
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
  const { member: focusedMember, setMember: setFocusedMember } = useFocusedInbox();
  const focusedMemberId = focusedMember?.userId ?? null;
  const [tasks, setTasks] = useState<AssignedTask[]>([]); // «Для меня»
  const [byMeTasks, setByMeTasks] = useState<AssignedTask[]>([]); // «Другим»
  // Личные (inbox) задачи коллег — отдельный источник, вливается во вкладку «Другим».
  // Сервер отдаёт их только по кругу общих рабочих пространств и всегда canModify: false.
  const [colleaguePersonalTasks, setColleaguePersonalTasks] = useState<AssignedTask[]>([]);
  // Доска сотрудника (клик по кубику руководителем) — отдельный источник: ВСЕ его
  // незавершённые задачи по всем проектам пространства, включая те, где сам руководитель
  // не участник (см. BUG D). Личных инбоксов colleaguePersonalTasks для этого мало.
  const [focusedMemberTasks, setFocusedMemberTasks] = useState<AssignedTask[]>([]);
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
  const setRowRef = useCallback(
    (el: HTMLDivElement | null): void => {
      hScrollElRef.current = el;
      setHScrollRef(el);
    },
    [setHScrollRef],
  );
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

  // Таймстемп ЛЮБОГО своего refresh() — не только после мутации, но и mount-эффекта,
  // смены вкладки/фильтра, возврата фокуса и т.п. (refresh() пишет сюда безусловно —
  // И в начале запроса, И по его завершении, см. refresh() ниже). Грубый гвард (см.
  // useEffect ниже) на 400мс глушит ЛЮБОЕ SSE-обновление в этом окне, не только
  // «эхо своей же мутации» — включая легитимное параллельное действие коллеги.
  // Осознанный компромисс брифа («грубый гвард»): в среднем такое окно раз в 250-400мс
  // после любого своего рефетча — цена редких секундных задержек чужого realtime-события
  // против частых двойных перерисовок от гарантированного эха своей же мутации.
  const lastRefreshAtRef = useRef(0);

  // Зеркало focusedMemberId для refresh(): refresh не должен зависеть от него напрямую —
  // иначе его identity меняется при каждом открытии/закрытии доски сотрудника, а refresh
  // стоит в deps mount-эффекта ниже (перечитал бы listMine/listOthers/listColleaguesPersonal
  // + getUiPrefs и заново мигнул скелетоном на КАЖДЫЙ клик по кубику — не то, ради чего он
  // существует). Читаем актуальное значение через ref в момент вызова.
  const focusedMemberIdRef = useRef(focusedMemberId);
  useEffect(() => {
    focusedMemberIdRef.current = focusedMemberId;
  }, [focusedMemberId]);

  const refresh = useCallback(async (): Promise<void> => {
    lastRefreshAtRef.current = Date.now();
    // Снимок на момент старта запроса — сверяем с актуальным ПОСЛЕ await (см. ниже), а не
    // просто читаем ref второй раз: доска могла закрыться и открыться на ДРУГОГО сотрудника
    // за время в полёте, и тогда актуальный id формально снова совпал бы со снимком, но
    // ответ всё равно принадлежал бы уже не тому запросу.
    const focusedAtStart = focusedMemberIdRef.current;
    try {
      const [mine, byMe, personal, focused] = await Promise.all([
        taskAssigneeRepository.listMine(),
        taskAssigneeRepository.listOthers(),
        taskAssigneeRepository.listColleaguesPersonal(),
        focusedAtStart
          ? taskAssigneeRepository.listMemberTasks(focusedAtStart)
          : Promise.resolve<AssignedTask[]>([]),
      ]);
      setTasks(mine);
      setByMeTasks(byMe);
      setColleaguePersonalTasks(personal);
      // Пишем focusedMemberTasks только если доска всё ещё открыта на ТОГО ЖЕ сотрудника —
      // иначе устаревший ответ перезаписал бы уже актуальные данные другого/пустого фокуса.
      if (focusedAtStart && focusedMemberIdRef.current === focusedAtStart) {
        setFocusedMemberTasks(focused);
      }
    } catch (e) {
      toast.error(`Не удалось загрузить задачи: ${(e as Error).message}`);
    } finally {
      // Штампуем ещё раз ПОСЛЕ применения ответа, не только в начале запроса: на медленной
      // сети (ответ дольше 400мс) эхо этой же мутации от SSE прилетает уже за пределами
      // окна, отсчитанного от старта, и второй refetch всё равно проходит гвард ниже.
      // Отсчёт от конца — гвард действительно перекрывает момент, когда наши же данные
      // только-только легли в state.
      lastRefreshAtRef.current = Date.now();
    }
  }, [taskAssigneeRepository]);

  // Открыли доску сотрудника (клик по кубику) — подтягиваем его задачи сразу, не дожидаясь
  // следующей SSE-волны/фокуса. Закрыли доску — сбрасываем, чтобы старые карточки не мелькали
  // при повторном открытии другого сотрудника. Отдельный эффект (не refresh()): именно он
  // реагирует на смену focusedMemberId, а refresh остаётся стабильным между кликами.
  useEffect(() => {
    if (!focusedMemberId) {
      setFocusedMemberTasks([]);
      return;
    }
    let cancelled = false;
    taskAssigneeRepository
      .listMemberTasks(focusedMemberId)
      .then((items) => {
        if (!cancelled) setFocusedMemberTasks(items);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          toast.error(`Не удалось загрузить задачи сотрудника: ${(e as Error).message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [focusedMemberId, taskAssigneeRepository]);

  // Пришли по ссылке из плашки «вам назначили задачу» — подсвечиваем карточку.
  useSpotlightTask(!loading && boardTasks !== null, refresh);

  // Realtime: задачу изменили в другой вкладке или это сделал коллега — например поставил
  // срочный приоритет. Без подписки подсветка появлялась бы только после перезагрузки.
  // Дебаунс: серия правок (приоритет + дедлайн + перенос) даёт пачку событий, а список
  // тяжёлый — перечитываем один раз в конце пачки.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Грубый гвард: ЛЮБОЙ refresh() (наш собственный, в т.ч. mount/фокус, не только
        // после мутации) в последние 400мс глушит эту SSE-волну целиком — она может
        // нести и эхо нашего же изменения (в подавляющем большинстве случаев — именно
        // его, приёмка/сдача на утверждение и т.п.), и легитимное действие коллеги,
        // прилетевшее в то же окно. Различить их без версионирования снапшота нельзя —
        // бриф разрешил именно грубый гвард; чужое событие в худшем случае долетит со
        // следующей волной (следующий SSE-event/фокус/интервал), не потеряется совсем.
        if (Date.now() - lastRefreshAtRef.current < 400) return;
        void refresh();
      }, 250);
    };
    window.addEventListener(TASK_CHANGED_EVENT, schedule);
    // Реконнект SSE: события, случившиеся при обрыве, до нас не дошли — читаем снапшот.
    window.addEventListener(REALTIME_CONNECTED_EVENT, schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, schedule);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, schedule);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Обе вкладки + сохранённую группировку грузим вместе и гейтим первый рендер на всё —
    // блок не «мигает» дефолтной группировкой/счётчиками перед применением реальных.
    Promise.all([
      taskAssigneeRepository.listMine(),
      taskAssigneeRepository.listOthers(),
      taskAssigneeRepository.listColleaguesPersonal(),
      userRepository.getUiPrefs(),
    ])
      .then(([mine, byMe, personal, prefs]) => {
        if (cancelled) return;
        setTasks(mine);
        setByMeTasks(byMe);
        setColleaguePersonalTasks(personal);
        // Сортировка ПЕРСИСТИТСЯ за аккаунтом (users.ui_prefs) — при перезагрузке та же.
        // (Была session-only «точка 4» — юзер передумал 2026-07-11.)
        if (prefs.inboxAssignedGrouping) setGrouping(prefs.inboxAssignedGrouping);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Не удалось загрузить задачи: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Перефетч при возврате на вкладку — ловим новые назначения без ручного refresh.
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
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

  // #2 (задача af1ebf44): инлайн-создание в колонке-проекте верхнего блока. Только вкладка
  // «Для меня» + группировка по проекту (колонка = реальный проект). Открытый композер держим
  // по projectId колонки; создаём задачу в backlog проекта, назначенную на текущего юзера, —
  // тогда карточка сразу попадает в эту же колонку. Без модального окна (как «+» на доске).
  const [composingProject, setComposingProject] = useState<string | null>(null);
  // Создаёт задачу в проекте на текущего юзера (backlog) и возвращает её — сигнатура под
  // InlineNewCard (тот же композер, что и в нижних канбанах: Enter создаёт и оставляет поле
  // для следующей, иконки, blur-commit). refresh() подтягивает свежую карточку в колонку.
  const createInProjectColumn = useCallback(
    async (projectId: string, name: string, icon: string | null): Promise<Task | null> => {
      if (!user) return null;
      const created = await taskRepository.create(projectId, {
        description: name,
        status: 'backlog',
        icon,
        assigneeUserId: user.id,
      });
      await refresh();
      onChanged?.();
      return created;
    },
    [user, taskRepository, refresh, onChanged],
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
  // Вкладка «Другим» = задачи, делегированные мной + личные доски коллег. Дедуп по id:
  // задача, которую я делегировал коллеге в ЕГО инбокс, приезжает из обоих источников.
  const byMeRaw = useMemo(() => {
    const seen = new Set(byMeTasks.map((t) => t.id));
    return [
      ...byMeTasks,
      ...colleaguePersonalTasks.filter((t) => !seen.has(t.id)),
    ].map(asAssignedInboxBlockTask);
  }, [byMeTasks, colleaguePersonalTasks]);
  const byMeDisplayTasks = useMemo(() => applyPatches(byMeRaw, patches), [byMeRaw, patches]);
  const toMeVisible = useMemo(
    () => (hideDone ? toMeTasks.filter(notDone) : toMeTasks),
    [toMeTasks, hideDone],
  );
  const byMeVisibleAll = useMemo(() => {
    const afterDone = hideDone ? byMeDisplayTasks.filter(notDone) : byMeDisplayTasks;
    return hidePersonal ? afterDone.filter((t) => !t.isInbox) : afterDone;
  }, [byMeDisplayTasks, hideDone, hidePersonal]);
  // Фильтры «ответственный / проект» — только вкладка «Другим», поверх hide-done.
  // Предикат вынесен: им же различаем причину пустоты (фильтры vs скрытые done).
  const matchesByMeFilters = useCallback(
    (t: AssignedInboxBlockTask): boolean =>
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

  // Снимаем отработавшие правки, когда подъехали живые данные. Без этого оверрайд навсегда
  // затеняет реальный статус и прячет чужие изменения (ловушка InboxCheckbox.optimistic).
  useEffect(() => {
    setPatches((prev) => withoutPatches(prev, settledPatchIds(prev, [...toMeRaw, ...byMeRaw, ...focusedRaw])));
  }, [toMeRaw, byMeRaw, focusedRaw]);
  const focusedVisible = useMemo(
    () => (hideDone ? focusedTasks.filter(notDone) : focusedTasks),
    [focusedTasks, hideDone],
  );
  const visibleTasks = focusedMemberId
    ? focusedVisible
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
  const inProgressTasks = useMemo(
    () => visibleTasks.filter((t) => t.status === 'manual'),
    [visibleTasks],
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
  const approvalTasks = useMemo(
    () =>
      selectApprovalTasks({ toMeTasks, byMeDisplayTasks, focusedTasks, focusedMemberId, isApprover }),
    [toMeTasks, byMeDisplayTasks, focusedTasks, focusedMemberId, isApprover],
  );
  const groupedTasks = useMemo(() => selectBoardTasks(visibleTasks), [visibleTasks]);
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
  const displayGroups = useExitingListItems(groups, (g) => g.key, EXIT_MS);
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
  // Выделяются ЛЮБЫЕ задачи колонки, включая те, что caller изменить не может (личные
  // доски коллег сервер отдаёт с canModify: false). Пользователь просил не ограничивать
  // выбор; задачи без прав просто попадут в «не удалось» при выполнении действия.
  const columnSelectableGroups = selectionColumns.map((g) => g.items.map((t) => t.id));
  // Полки «На утверждении» и «Вручную» — такие же участники выделения, как колонки: раньше
  // при включении режима они просто пропадали с экрана, и до этих задач массовые действия
  // было не достать вовсе. Идут первыми, потому что первыми же и нарисованы — порядок
  // важен для Shift-диапазона и протяжки мышью, которые считают по этому же списку.
  const selectableGroups = [
    approvalTasks.map((t) => t.id),
    inProgressTasks.map((t) => t.id),
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
  useEffect(() => {
    let cancelled = false;
    projectRepository
      .listSharedMembers()
      .then((m) => {
        if (!cancelled) setMembers(m);
      })
      .catch(() => {
        /* тихо: кубики просто не покажем, drag-срок и остальное работают */
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository]);
  // Сотрудник выпал из пространства (или роль перестала быть руководящей) — возвращаемся
  // к своим входящим, иначе блок завис бы на пустой чужой доске без выхода.
  useEffect(() => {
    if (focusedMemberId === null) return;
    if (!isWorkspaceLead || (members.length > 0 && !members.some((m) => m.id === focusedMemberId))) {
      setFocusedMember(null);
    }
  }, [focusedMemberId, isWorkspaceLead, members, setFocusedMember]);

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
        await refresh();
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
        await refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось забрать: ${(e as Error).message}`);
      }
    },
    [user, taskRepository, refresh, onChanged],
  );

  // Вспышка полки «В работе»: `key` растёт на каждое взятие задачи (булев флаг не дал бы
  // перезапустить анимацию на второй задаче подряд), `id` — какую карточку подсветить.
  const [workFlash, setWorkFlash] = useState<{ id: string; key: number } | null>(null);

  // Взять в работу / убрать из работы. 'manual' — «делаю руками», агент такие задачи
  // никогда не подхватывает; backlog — «Черновики», нейтральное «не занимаюсь сейчас».
  // Возврат НЕ в todo: в личных входящих это колонка «Воркер», задачу забрал бы Ralph.
  const setWorkStatus = useCallback(
    async (item: InboxBlockTask, next: 'manual' | 'backlog'): Promise<void> => {
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
        void refresh();
        onChanged?.();
      } catch (e) {
        dropPatch(item.id);
        toast.error(`Не удалось: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged, dropPatch],
  );

  // Отправить свою задачу на приёмку жестом. Явный 'pending_approval' сервер пропускает
  // без подмены (подмена срабатывает только на 'done'), а уведомление принимающему шлёт
  // сам MoveTask — отдельного вызова не нужно.
  const sendToApproval = useCallback(
    async (item: InboxBlockTask): Promise<void> => {
      // Как и на остальных полках: карточка на месте назначения сразу, сеть — фоном.
      setPatches((prev) => withPatch(prev, item.id, { kind: 'status', status: 'pending_approval' }));
      try {
        await taskRepository.move(item.projectId, item.id, {
          targetStatus: 'pending_approval',
          beforeTaskId: null,
          afterTaskId: null,
        });
        void refresh();
        onChanged?.();
      } catch (e) {
        dropPatch(item.id);
        toast.error(`Не удалось отправить на утверждение: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged, dropPatch],
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

  // Отзыв задачи с утверждения самим исполнителем: «случайно нажал выполнено».
  const withdrawApproval = async (item: InboxBlockTask): Promise<void> => {
    try {
      await taskRepository.withdrawApproval(item.projectId, item.id);
      forget(item.id);
      toast.success('Задача снова в работе');
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(`Не удалось забрать: ${(e as Error).message}`);
    }
  };

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
      | { type?: string; bucket?: string; member?: SharedMember; status?: 'manual' | 'backlog' }
      | undefined;
    const item = e.active.data.current?.item as InboxBlockTask | undefined;
    if (!over || !item || !data) return;
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

  if (loading || boardTasks === null) return null;

  // #2: единая кнопка «Фильтры» в шапке страницы. Сортировка (когда есть задачи) +
  // скрыть-выполненные (всегда) + фильтры ответственного/проекта (только вкладка «Другим»).
  // Открытая доска сотрудника держит блок на экране, даже если своих задач нет вовсе, —
  // иначе руководитель кликнул бы по кубику и зона исчезла бы у него из-под рук. По той же
  // причине руководителю с пустыми входящими зона показывается ради самих кубиков: без
  // них инструмент «открыть входящие сотрудника» ему просто негде взять (тот же приём,
  // что и с полкой приёмки для принимающего).
  const hasAny =
    toMeVisible.length > 0 ||
    byMeVisibleAll.length > 0 ||
    focusedMemberId !== null ||
    (isWorkspaceLead && members.length > 0);
  const filtersPopover = (
    <InboxFiltersPopover
      showSort={hasAny}
      // Фильтры «кому/проект» — про вкладку «Для всех»; на чужой доске фильтровать нечего.
      showFilters={hasAny && !focusedMemberId && tab === 'byMe' && byMeTasks.length > 0}
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
  const filtersToolbar = toolbarSlot ? createPortal(filtersPopover, toolbarSlot) : null;

  // Блок скрыт, когда пусто В ОБЕИХ вкладках (с учётом hide-done): саму зону не рисуем, но
  // кнопку «Фильтры» (скрыть-выполненные для доски ниже) в шапке страницы оставляем.
  if (!hasAny) return filtersToolbar;

  const subtitleBase = focusedMember
    ? 'Все задачи сотрудника по пространству — открыты вам как руководителю'
    : tab === 'toMe'
      ? 'Задачи, за которые отвечаете вы'
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
      : byMeTasks.length === 0
        ? 'Задач других участников пока нет'
        : anyByMeFilter && !byMeDisplayTasks.some(matchesByMeFilters)
          ? 'Под выбранные фильтры ничего не попадает'
          : // Фильтрам (если есть) в СЫРОМ списке что-то соответствует, но видимых нет —
            // значит, спрятал Eye-toggle, и говорим про него, а не виним фильтры.
            'Все подходящие задачи выполнены и скрыты («Скрыть выполненные»)';

  // Тело блока — общее для обоих режимов.
  // Персональная зона, Notion-стиль: НЕ карточка-в-рамке (рамка враждует с full-bleed
  // канбана). «Это моё» несут три тихих сигнала: identity-шапка (свой аватар + настоящий
  // заголовок + синяя count-пилюля + подзаголовок-контракт), шёпот-тинт primary на
  // колонках канбана и hairline-линейка, замыкающая зону перед основной доской.
  const body = (
    <section id="assigned-to-me" className="space-y-3">
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3 px-0.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Своя ава (владелец зоны) — И drop-цель «забрать себе»: перетащи задачу сюда, чтобы
                вернуть/назначить её себе. size-8 крупнее аватаров в строках/карточках. */}
            {user ? (
              <SelfDropAvatar user={user} dragging={dragActive} />
            ) : (
              <UserAvatar displayName="" className="size-8 text-[11px]" />
            )}
            <div className="min-w-0">
              {/* Режим чужой доски заменяет вкладки заголовком с именем: вкладки «Мои/Для
                  всех» тут не про что — показывается одна конкретная доска. Возврат — ×. */}
              {focusedMember ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">
                    Задачи · {focusedMember.displayName}
                  </h2>
                  <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                    {focusedVisible.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusedMember(null)}
                    aria-label="Вернуться к своим входящим"
                    title="Вернуться к своим входящим"
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                /* -ml-2 гасит внутренний px-2 первого таба — текст «Для меня» встаёт ровно
                   там, где стоял бы обычный заголовок (и подзаголовок под ним). */
                <AssigneeTabs
                  tab={tab}
                  onChange={handleTabChange}
                  toMeCount={toMeVisible.length}
                  // #3: бейдж «Другим» = РЕАЛЬНО отрисованный список (с учётом фильтров от/кому/
                  // проект), а не сырой byMeVisibleAll — иначе при активном фильтре число на вкладке
                  // расходилось с количеством видимых карточек («неверное количество»).
                  byMeCount={byMeVisible.length}
                />
              )}
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitleBase}</p>
            </div>
          </div>
          {/* Единая кнопка «Фильтры» порталится в шапку страницы (toolbarSlot). Фолбэк (нет
              слота) — рендерим на месте, в шапке блока. Сам портал отдаётся из return ниже. */}
          {!toolbarSlot && (
            <div className="flex flex-wrap items-center justify-end gap-1 self-center">{filtersPopover}</div>
          )}
        </div>

        {/* Кубики участников для делегации (задача 3a36e7e8) — СЛЕВА, крупными блоками,
            переносятся на несколько строк (все видны сразу). Тащить карточку на них удобнее,
            чем в мелкий ряд у правого края. Каждый блок — drop-цель смены ответственного;
            под курсором раскрывается в «Назначить: <имя>». На «Другим» блок ещё и клик-фильтр
            «кому». Во время drag добавляется тихая подпись-подсказка слева. */}
        {members.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-0.5">
            {members.map((m) => (
              <UserCube
                key={m.id}
                member={m}
                dragging={dragActive}
                // Руководитель/владелец: клик открывает личные входящие сотрудника (на любой
                // вкладке). Остальным остаётся прежний клик-фильтр «кому» на «Для всех»
                // (спека 2026-07-13); руководителю тот же фильтр доступен в меню «Фильтры».
                // На «Для меня» без обеих ролей пропы не передаём — кубик только drop-цель.
                {...(isWorkspaceLead
                  ? {
                      filterActive: focusedMemberId === m.id,
                      onToggleFilter: () =>
                        setFocusedMember(
                          focusedMemberId === m.id
                            ? null
                            : { userId: m.id, displayName: m.displayName },
                        ),
                      clearLabel: 'Вернуться к своим входящим',
                      hint: 'нажмите, чтобы открыть его входящие',
                    }
                  : tab === 'byMe'
                    ? {
                        filterActive: filterTo === m.id,
                        onToggleFilter: () =>
                          setFilterTo((prev) => (prev === m.id ? null : m.id)),
                      }
                    : {})}
              />
            ))}
          </div>
        )}
      </div>

      {/* Полка «В работе» — над колонками, всегда видима: это ответ на вопрос «чем я занят
          прямо сейчас». Принимает дроп карточки (статус → manual), карточки внутри
          можно вернуть обратно кнопкой. Не показываем только в режиме выделения, где drag
          отключён и полка была бы мёртвой. */}
      {/* Полка нужна и рядовому исполнителю с пустой очередью: это единственная цель
          дропа для «сдать первую задачу» жестом, и без неё жест физически некуда
          применить, пока в очереди не появится хотя бы одна чужая/старая карточка. */}
      {(approvalTasks.length > 0 || (approvalEnabled && !selectionActive)) && (
        <ApprovalShelf
          items={approvalTasks}
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
          {...(focusedMember
            ? {
                emptyHint: `Задач на утверждении от ${focusedMember.displayName} сейчас нет.`,
              }
            : {})}
          className={cn(bleedNegClass, bleedPadClass)}
        />
      )}

      {/* В режиме выделения пустую полку прячем: тащить в неё нечего, а подсказка
          «перетащите сюда» врала бы. С задачами — остаётся, их тоже выделяют. */}
      {(inProgressTasks.length > 0 || !selectionActive) && (
        <InProgressShelf
          items={inProgressTasks}
          onOpen={(t) => setDrawerTask(t)}
          onChanged={handleToggled}
          onDelete={handleDelete}
          onRemoveFromWork={(t) => void setWorkStatus(t, 'backlog')}
          flashKey={workFlash?.key ?? 0}
          flashItemId={workFlash?.id ?? null}
          selecting={selectionActive}
          selectedIds={selectedIds}
          onSelectToggle={handleSelectToggle}
          className={cn(bleedNegClass, bleedPadClass)}
        />
      )}

      {visibleTasks.length === 0 ? (
        // Пустая активная вкладка при живой соседней: тихая строка вместо пустых колонок.
        <p className="px-0.5 py-1 text-sm text-muted-foreground/60">{emptyText}</p>
      ) : grouping === 'deadline' ? (
        // Сортировка «по дедлайну» = 3 колонки по времени (Без срока / На сегодня / Будущее).
        // Drag между колонками меняет дедлайн; drag на аватар участника — назначает его. Ряд
        // колонок full-bleed'ится за паддинг страницы (как доска проекта).
        <div
          ref={setRowRef}
          onScroll={onHScroll}
          className={cn(
            // Как у основной доски: каждая колонка заканчивается под своей последней
            // задачей, а не растягивается до высоты самой длинной соседней колонки.
            'flex items-start snap-x snap-mandatory sm:snap-none gap-3 overflow-x-auto overscroll-x-none pb-2',
            // Родной горизонтальный скролл прячем — видимый и закреплённый снизу даёт
            // SyncedStickyScrollbar (иначе внизу второй «раздвоенный» бар, как на доске).
            '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            bleedNegClass,
            bleedPadClass,
          )}
        >
          {kanbanGroups.map((group, index) => (
            // Дроп-зона (drag-срок/ответственный) + перетаскиваемые карточки.
            <TimeBucketColumn
              key={group.key}
              bucket={group.key}
              label={group.label}
              count={group.items.length}
              selection={columnSelectionAt(index)}
              onSelectAll={handleSelectAllIn}
              onSelectNone={handleSelectNoneIn}
              onCardsPointerDown={dragSelect.onPointerDown}
            >
              {group.items.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground/45">Пусто</p>
              ) : (
                <ColumnPreviewList
                  // key по вкладке+фильтрам: смена датасета ремаунтит список (не тащим
                  // позицию скролла колонки между вкладками).
                  key={[tab, filterTo ?? '', filterProject ?? ''].join('|')}
                  items={group.items}
                  getId={(item) => item.id}
                  renderItem={(item, cardExiting) => (
                    <DraggableTask
                      key={item.id}
                      item={item}
                      disabled={!item.canModify || cardExiting}
                      selecting={selectionActive}
                      ghost={cardExiting}
                    >
                      <AcceptedCard
                        item={item}
                        onOpen={() => setDrawerTask(item)}
                        onChanged={handleToggled}
                        onDelete={() => handleDelete(item)}
                        selecting={selectionActive}
                        selected={selectedIds.has(item.id)}
                        onSelectToggle={handleSelectToggle}
                      />
                    </DraggableTask>
                  )}
                />
              )}
            </TimeBucketColumn>
          ))}
          {/* Хвостовой спейсер (моб): пустота справа, чтобы последняя колонка вставала по
              ЦЕНТРУ и через snap, и через max-scroll (iOS). Ширина = «пипке» соседа. */}
          <div aria-hidden className="w-[max(7vw,calc(50vw_-_11rem))] shrink-0 sm:hidden" />
        </div>
      ) : (
        // Прочие сортировки (проект / дата создания / приоритет): горизонтальные КОЛОНКИ-канбаны —
        // каждая группа = колонка-бордер с заголовком-ярлыком и задачами внутри (задачи одного
        // проекта в одной колонке). Всегда канбан, никаких списков. Ряд full-bleed за паддинг.
        // Пока тащат карточку С ДОСКИ (boardDragActive) колонки становятся drop-целями по
        // смыслу сортировки, а первой в ряду появляется фантомная колонка (см. план
        // inbox-grouped-dnd): «Другой проект…» / инфо «Сюда нельзя» / «Другой приоритет…».
        <div
          ref={setRowRef}
          onScroll={onHScroll}
          className={cn(
            'flex items-start snap-x snap-mandatory sm:snap-none gap-3 overflow-x-auto overscroll-x-none pb-2',
            // Родной горизонтальный скролл прячем — видимый и закреплённый снизу даёт
            // SyncedStickyScrollbar (иначе внизу второй «раздвоенный» бар, как на доске).
            '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            bleedNegClass,
            bleedPadClass,
          )}
        >
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
            // Смысл дропа карточки доски на колонку: project → перенос задачи в проект
            // («Личные» — не цель, задача и так в инбоксе); priority → смена приоритета;
            // created — колонки не принимают (дату создания не изменить). Призрак дроп не
            // принимает вовсе — она уже уходит.
            const dropData =
              exiting
                ? null
                : grouping === 'project' && !group.isInbox
                  ? { type: 'group', grouping: 'project', projectId: group.key }
                  : grouping === 'priority'
                    ? { type: 'group', grouping: 'priority', priority: group.key }
                    : null;
            const columnSelection = index >= 0 ? columnSelectionAt(index) : null;
            // #2 (af1ebf44): колонка = реальный проект (группировка по проекту, не «Личные»).
            // Тогда её название кликабельно (→ страница проекта), а по ховеру доступна «+».
            const isProjectColumn = grouping === 'project' && !group.isInbox;
            // «+» на колонке-проекте — на ОБЕИХ вкладках («Мои» И «Для всех»: юзер спросил
            // «где плюсы» на «Для всех»). Гейт по canModify: показываем там, где у юзера есть
            // право менять задачи проекта (≈ право создавать). Задача создаётся в этом проекте
            // на текущего юзера, поэтому попадёт во вкладку «Мои» (о чём говорит тост).
            const canQuickAdd = !exiting && isProjectColumn && group.items.some((i) => i.canModify);
            return (
            // Обёртка-коллапс СНАРУЖИ droppable-колонки (не на самом её узле — droppable
            // ref живёт внутри GroupDropColumn) — overflow:hidden тут не задевает measure
            // dnd-kit'а над самим droppable/sortable-узлом (см. брифа примечание про
            // «залипший transform»). data-pf-collapse — едет и при выключенных на тач
            // анимациях (globals.css .pf-no-motion исключение).
            <div
              key={group.key}
              data-pf-collapse
              className="grid shrink-0 transition-all duration-300 ease-out motion-reduce:transition-none"
              style={{ gridTemplateColumns: exiting ? '0fr' : '1fr' }}
            >
            <div className={cn('min-w-0', exiting ? 'overflow-hidden' : 'overflow-visible')}>
            <GroupDropColumn
              id={`group-${grouping}-${group.key}`}
              data={dropData}
              highlight={boardDragActive}
              exiting={exiting}
              className={cn(
                'group/col flex w-[86vw] max-w-[22rem] shrink-0 snap-center snap-always flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-muted/20 dark:border-white/[0.10] dark:bg-white/[0.02] sm:w-72 sm:max-w-none',
                exiting && 'pointer-events-none opacity-0 transition-opacity duration-200 motion-reduce:transition-none',
              )}
            >
              <div className="flex items-center gap-1.5 border-b border-black/[0.06] bg-muted/50 px-2.5 py-1.5 text-xs font-semibold text-foreground/80 dark:border-white/[0.06] dark:bg-white/[0.04]">
                <GroupIcon mode={grouping} isInbox={group.isInbox} />
                {isProjectColumn ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${group.key}`)}
                    title="Открыть проект"
                    className="min-w-0 truncate text-left underline-offset-2 transition-colors hover:text-primary hover:underline"
                  >
                    {group.label}
                  </button>
                ) : (
                  <span className="truncate">{group.label}</span>
                )}
                {columnSelection ? (
                  <ColumnSelectionControls
                    selection={columnSelection}
                    onAll={handleSelectAllIn}
                    onNone={handleSelectNoneIn}
                  />
                ) : (
                  <span className="ml-auto shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {group.items.length}
                  </span>
                )}
                {canQuickAdd && !columnSelection && (
                  <button
                    type="button"
                    aria-label="Создать задачу в проекте"
                    title="Создать задачу"
                    onClick={() =>
                      setComposingProject((p) => (p === group.key ? null : group.key))
                    }
                    // Всегда видна (как «+» в шапке колонок на досках проекта) — юзер жаловался,
                    // что hover-only «+» не заметен. Тихий muted, ярче по наведению.
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground"
                  >
                    <Plus className="size-4" />
                  </button>
                )}
              </div>
              <div
                onPointerDown={columnSelection ? dragSelect.onPointerDown : undefined}
                className={cn('flex flex-col gap-1.5 p-1.5', COLUMN_SCROLL_CLASS)}
              >
                {/* #2: инлайн-создание сверху колонки-проекта — ТОТ ЖЕ композер, что и в
                    нижних канбанах (InlineNewCard): плавно, Enter создаёт и оставляет поле для
                    следующей, иконки, blur-commit. Без модального окна. */}
                {composingProject === group.key && (
                  <InlineNewCard
                    onCreate={(name, icon) => createInProjectColumn(group.key, name, icon)}
                    onClose={() => setComposingProject(null)}
                    onOpenFull={() => setComposingProject(null)}
                  />
                )}
                <ColumnPreviewList
                  key={[grouping, group.key].join('|')}
                  items={group.items}
                  getId={(item) => item.id}
                  renderItem={(item, cardExiting) => (
                    <DraggableTask
                      key={item.id}
                      item={item}
                      disabled={!item.canModify || exiting || cardExiting}
                      selecting={selectionActive}
                      // Вся ГРУППА-колонка сейчас призрак (useExitingListItems держит её старый
                      // снимок вместе с карточками) — карточка внутри могла уже переехать в
                      // другую живую колонку с тем же item.id. Без суффикса unmount призрака
                      // стёр бы draggableNodes-запись живой карточки, и та молча переставала
                      // бы таскаться (см. draggableTaskId). То же и для призрака ОДНОЙ
                      // карточки, доигрывающей своё схлопывание внутри живой колонки.
                      ghost={exiting || cardExiting}
                    >
                      <AcceptedCard
                        item={item}
                        onOpen={() => setDrawerTask(item)}
                        onChanged={handleToggled}
                        onDelete={() => handleDelete(item)}
                        showCreatedAt={grouping === 'created'}
                        hideProjectLabel={grouping === 'project'}
                        selecting={selectionActive}
                        selected={selectedIds.has(item.id)}
                        onSelectToggle={handleSelectToggle}
                      />
                    </DraggableTask>
                  )}
                />
              </div>
            </GroupDropColumn>
            </div>
            </div>
            );
          })}
          {/* Хвостовой спейсер (моб): пустота справа, чтобы последняя колонка вставала по
              ЦЕНТРУ и через snap, и через max-scroll (iOS). Ширина = «пипке» соседа. */}
          <div aria-hidden className="w-[max(7vw,calc(50vw_-_11rem))] shrink-0 sm:hidden" />
        </div>
      )}

      {/* Закреплённый снизу вьюпорта горизонтальный скролл ряда верхних канбанов — как на
          досках проектов (запрос юзера: «скролл всегда закреплён снизу при скролле страницы»).
          Прилипает к низу вьюпорта, пока зона #assigned-to-me в поле зрения; рендерится
          только при переполнении и только на десктопе (на мобиле ряд листается свайпом). */}
      <SyncedStickyScrollbar key={grouping} targetRef={hScrollElRef} className={bleedNegClass} />

      {/* Hairline-линейка замыкает персональную зону перед основной доской. В канбане
          уезжает full-bleed теми же отрицательными маржинами, что и ряд колонок (в list
          bleedNegClass = '' — линия в ширину читаемой колонки). !mt-* перебивает space-y-3
          секции: линии нужно больше воздуха сверху, чем шагу шапка→тело. */}
      <div
        aria-hidden
        className={cn(
          '!mt-5 mb-1 border-t border-border sm:!mt-6 sm:mb-2',
          // Ряд колонок (при любой сортировке) full-bleed'ится за паддинг — линия тоже.
          bleedNegClass,
        )}
      />

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
        onConfirm={async () => {
          const pending = pendingReassign;
          if (!pending) return;
          await reassignTo(pending.item, pending.member);
          setPendingReassign(null);
        }}
      />
    </section>
  );

  return (
    // Один DndContext на всю зону: и временные колонки (drag → срок), и кубики людей
    // (drag → смена ответственного) — общие drop-цели одного перетаскивания карточки.
    <>
      {filtersToolbar}
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
      className="pointer-events-none flex max-w-[15rem] cursor-grabbing items-center gap-1.5 rounded-full border border-primary/40 bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-lg ring-1 ring-primary/20"
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
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      <span className="tabular-nums text-[10px] text-muted-foreground">
        Выбрано {selection.count}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-[11px] max-sm:h-9"
        disabled={selection.ids.length === 0}
        onClick={() => onAll(selection.ids)}
      >
        Все
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-[11px] max-sm:h-9"
        disabled={selection.count === 0}
        onClick={() => onNone(selection.ids)}
      >
        Очистить
      </Button>
    </span>
  );
}

// Колонка канбана «по времени» = drop-зона. При наведении таскаемой карточки колонка
// подсвечивается (ring), сигналя, что дроп сменит срок на этот бакет.
function TimeBucketColumn({
  bucket,
  label,
  count,
  selection = null,
  onSelectAll,
  onSelectNone,
  onCardsPointerDown,
  children,
}: {
  bucket: string;
  label: string;
  count: number;
  // Режим выделения: счётчик + «Все»/«Очистить» по ЭТОЙ колонке. null — режим выключен.
  selection?: ColumnSelection | null;
  onSelectAll?: (ids: readonly string[]) => void;
  onSelectNone?: (ids: readonly string[]) => void;
  // Старт протяжки-выделения (см. useDragSelect) — на контейнере карточек.
  onCardsPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket-${bucket}`, data: { type: 'bucket', bucket } });
  return (
    <div
      ref={setNodeRef}
      // Шёпот-тинт primary вместо серого muted — колонки читаются «чуть голубыми» на фоне
      // серых колонок доски ниже. На мобиле альфа выше, в dark ещё выше. Не поднимать выше
      // /[0.09]//[0.11] — начинает «светиться».
      className={cn(
        'flex w-[86vw] max-w-[22rem] shrink-0 snap-center snap-always flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-primary/[0.06] transition-shadow dark:border-white/[0.10] dark:bg-primary/[0.09] sm:w-72 sm:max-w-none sm:bg-primary/[0.04] sm:dark:bg-primary/[0.07]',
        isOver && 'ring-2 ring-inset ring-primary',
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-black/[0.06] px-3 pb-1.5 pt-2.5 text-xs font-medium text-muted-foreground dark:border-white/[0.06]">
        <TimeBucketIcon bucket={bucket} />
        <span className="min-w-0 truncate">{label}</span>
        {selection && onSelectAll && onSelectNone ? (
          <ColumnSelectionControls
            selection={selection}
            onAll={onSelectAll}
            onNone={onSelectNone}
          />
        ) : (
          <span className="shrink-0 text-muted-foreground/60">{count}</span>
        )}
      </div>
      <div
        // Хук пассивен вне режима выделения, но лишний слушатель на обычной колонке не вешаем.
        onPointerDown={selection ? onCardsPointerDown : undefined}
        className={cn('flex min-h-[3rem] flex-col gap-2 px-2 pb-2', COLUMN_SCROLL_CLASS)}
      >
        {children}
      </div>
    </div>
  );
}

// Колонка-группа (сортировки проект/дата/приоритет) как drop-цель для карточек ДОСКИ
// (единый DnD, план inbox-grouped-dnd). data=null (created / «Личные») — цель выключена,
// обычная колонка. Подсветка ring — только пока тащат карточку с доски (highlight).
function GroupDropColumn({
  id,
  data,
  highlight,
  className,
  // Колонка сейчас схлопывается (группа опустела) — её собственный opacity-переход
  // (см. className вызывающего кода) получает data-pf-collapse, иначе на тач он
  // проседает в 0.01ms под pf-no-motion отдельно от grid-схлопывания враппера снаружи
  // (то же рассинхрон-ревью, что было у InProgressShelf: коробка едет, карточка гаснет
  // рывком). Не ставим атрибут БЕЗУСЛОВНО — иначе он заодно форсировал бы duration и у
  // соседнего drag-highlight ring'а (transition-all выше), которого сейчас это не касается.
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
        // Пока тащат карточку с доски: все колонки-цели получают тихий ринг-намёк, а та, что
        // под курсором, — сплошной ринг + лёгкий тинт. Одно из двух (не оба разом — конфликт
        // ring-1/ring-2 в CSS решался бы порядком в стайлшите, а не в className).
        data !== null && highlight && 'transition-all duration-200',
        data !== null &&
          highlight &&
          (isOver
            ? 'bg-primary/[0.05] ring-2 ring-inset ring-primary'
            : 'ring-1 ring-inset ring-primary/15'),
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
        'flex w-40 shrink-0 snap-center snap-always flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-4 text-center transition-all duration-200 sm:w-44',
        isOver && 'scale-[1.02] border-primary bg-primary/[0.08]',
      )}
    >
      <Icon className={cn('size-5', isOver ? 'text-primary' : 'text-primary/60')} />
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <span className="text-[10px] leading-tight text-muted-foreground/70">{hint}</span>
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
                  <div className="grid size-16 place-items-center rounded-md border px-1 text-center text-[10px] leading-tight text-muted-foreground">
                    <span className="line-clamp-3 break-all">{f.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  aria-label={`Убрать ${f.file.name}`}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-opacity hover:text-foreground"
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

// Полка «На утверждении» (db/150): очередь приёмки руководителя. Появляется только когда
// есть что принимать, поэтому командам без приёмки страница выглядит как раньше. Цвет —
// фиолетовый, тот же, что у одноимённой колонки на доске проекта.
function ApprovalShelf({
  items,
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
  selecting = false,
  selectedIds,
  onSelectToggle,
  className,
}: {
  items: readonly InboxBlockTask[];
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
  // Идёт ЛЮБОЙ drag общего контекста — нужен для тихого ring-намёка «сюда можно», того же,
  // что у соседних GroupDropColumn: полка не должна раскрываться только под курсором.
  dragActive: boolean;
  // Чем объяснить пустую полку. На доске сотрудника это «у него нечего принимать», а не
  // общее «сотрудники ещё ничего не сдали» — иначе руководитель читает чужую очередь как свою.
  emptyHint?: string;
  // Режим выделения: карточки полки выбираются наравне с карточками колонок, решения
  // приёмки при этом прячем — «Принять» это решение по одной задаче, а не массовое действие.
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  className?: string;
}): React.ReactElement {
  // Цель дропа. disabled гасит её целиком: недоступная полка не попадает в коллизии,
  // не подсвечивается и не может принять карточку.
  const { setNodeRef, isOver } = useDroppable({
    id: 'approval-shelf',
    data: { type: 'approval' },
    disabled: !canDrop || selecting,
  });
  // Пустую полку видит теперь и рядовой исполнитель (не только принимающий) — текст
  // по умолчанию должен объяснять её именно ему: это цель для СВОЕЙ сделанной работы,
  // а не чужая очередь. emptyHint (доска сотрудника) и isApprover-текст — не трогаем.
  const defaultEmptyHint = isApprover
    ? 'Здесь появятся задачи, которые сотрудники отметили выполненными. Закрыть их можете только вы.'
    : 'Сюда перетаскивают свою сделанную работу, чтобы её принял руководитель.';
  return (
    <div className={className}>
      <div
        ref={setNodeRef}
        className={cn(
          'rounded-xl border border-violet-300/50 bg-violet-100/40 px-2.5 py-2 transition-colors duration-150 dark:border-violet-400/20 dark:bg-violet-400/[0.07]',
          // Пока тащат карточку, которую можно бросить сюда: тихий ring-намёк того же
          // языка, что у GroupDropColumn (та же ring-1/inset-primary/15), плюс сплошной
          // ring под курсором — иначе полка «молчит» до тех пор, пока не наведёшься точно.
          canDrop && dragActive && !isOver && 'ring-1 ring-inset ring-primary/15',
          isOver &&
            'border-violet-400/80 bg-violet-200/60 dark:border-violet-300/50 dark:bg-violet-400/[0.16]',
        )}
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-violet-800 dark:text-violet-300/90">
          <ShieldCheck className="size-3 shrink-0" />
          <span>На утверждении</span>
          {items.length > 0 && <span className="tabular-nums opacity-70">{items.length}</span>}
        </div>
        {items.length === 0 ? (
          // Пустую очередь теперь видят и принимающий, и рядовой исполнитель (см.
          // approvalEnabled у родителя) — без этого либо новую область не находят, либо
          // цели дропа для «сдать первую задачу» жестом попросту нет.
          <p className="px-0.5 py-1 text-xs text-violet-800/60 dark:text-violet-200/45">
            {emptyHint ?? defaultEmptyHint}
          </p>
        ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <ApprovalItemCard
              key={item.id}
              item={item}
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
          ))}
        </div>
        )}
      </div>
    </div>
  );
}

// Карточка полки «На утверждении»: кнопка «Принять» проигрывает тот же паттерн, что и
// AcceptedCard.completePhase (flash 200мс → collapse 300мс → сеть после), только триггером
// служит явная кнопка, а не жест по самой карточке. Раньше конфетти/тост стреляли сразу
// после ответа сервера, а карточка висела до конца refresh() — казалось, что клик не сработал.
function ApprovalItemCard({
  item,
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
  // Общий движок фаз (useFlashExitPhase, см. AcceptedCard.completePhase выше и сам хук):
  // в зависимостях его эффекта — только item.id, а onAccept/onError уходят через ref
  // внутри хука. Это важно именно здесь — полка рендерит НЕСКОЛЬКО таких карточек сразу,
  // и refresh() от соседней (свой же после её приёмки, SSE-эхо, mount/visibilitychange)
  // пересобирает approvalTasks и меняет ссылку на item у ВСЕХ смонтированных карточек.
  // Раньше это был весь `item` в зависимостях — эффект перезапускался, отменял уже
  // тикающий таймер и взводил его заново: при приёмке нескольких задач подряд карточка
  // могла визуально исчезнуть, а move() так и не вызваться.
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

  return (
    // Тот же коллапс-паттерн, что у AcceptedCard, но по ОБЕИМ осям: полка — flex-wrap-ряд
    // (ApprovalShelf), и только схлопывание ШИРИНЫ сдвигает соседей по строке влево; высота
    // сама по себе (как у одиночного AcceptedCard в вертикальном списке) на flex-wrap не
    // влияет. Здесь он охватывает и карточку, и ряд кнопок под ней — снаружи AcceptedCard
    // трогать не нужно. data-pf-collapse — едет даже при выключенных на тач анимациях
    // (globals.css .pf-no-motion исключение), полка «На утверждении» видна и на телефоне.
    <div
      data-pf-collapse
      className={cn(
        'grid transition-all duration-300 ease-out motion-reduce:transition-none',
        phase === 'exit' && 'opacity-0',
      )}
      style={{
        gridTemplateColumns: phase === 'exit' ? '0fr' : '1fr',
        gridTemplateRows: phase === 'exit' ? '0fr' : '1fr',
      }}
    >
      <div className={cn('min-h-0 min-w-0', phase === 'exit' ? 'overflow-hidden' : 'overflow-visible')}>
        <div
          className={cn(
            'w-[17rem] max-w-full shrink-0 grow-0 space-y-1 rounded-lg transition-all duration-200 motion-reduce:transition-none',
            phase === 'flash' && 'scale-[1.02] ring-2 ring-emerald-500/50',
            phase === 'exit' && 'scale-[0.96]',
          )}
        >
          <AcceptedCard
            item={item}
            onOpen={onOpen}
            onChanged={onChanged}
            onDelete={onReject}
            hideQuickActions
            selecting={selecting}
            selected={selected}
            {...(onSelectToggle ? { onSelectToggle } : {})}
          />
          {/* Явные кнопки, а не только чекбокс: приёмка — решение, а не отметка. В режиме
              выделения их прячем: решение принимают по одной задаче, а не пачкой. */}
          {selecting ? null : isApprover ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={startAccept}
                disabled={accepting}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-70 dark:text-emerald-400"
              >
                {accepting && <Loader2 className="size-3 animate-spin" />}
                Принять
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={accepting}
                className="flex-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Вернуть в работу
              </button>
            </div>
          ) : item.assignee.userId === currentUserId ? (
            // Исполнителю — выход из тупика: отправил по ошибке, забрал обратно.
            <button
              type="button"
              onClick={onWithdraw}
              disabled={accepting}
              className="w-full rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="Забрать задачу с утверждения и продолжить работу"
            >
              Забрать обратно
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Полка «В работе»: мягко-жёлтая зона над колонками, куда перетаскивают задачи, которыми
// занимается сам (статус manual — агент такие не берёт). Подсвечивается при наведении драга. Пустая
// показывает подсказку — иначе непонятно, что сюда можно тащить.
function InProgressShelf({
  items,
  onOpen,
  onChanged,
  onDelete,
  onRemoveFromWork,
  flashKey,
  flashItemId,
  selecting = false,
  selectedIds,
  onSelectToggle,
  className,
}: {
  items: readonly InboxBlockTask[];
  onOpen: (item: InboxBlockTask) => void;
  onChanged: () => void;
  onDelete: (item: InboxBlockTask) => void;
  onRemoveFromWork: (item: InboxBlockTask) => void;
  // Растёт на каждое взятие задачи в работу — полка проигрывает вспышку.
  flashKey: number;
  // Какую карточку подсветить вместе с полкой (та, что только что приехала).
  flashItemId: string | null;
  // Режим выделения: карточки полки выбираются наравне с колоночными, dnd и точечные
  // действия («убрать из работы») на это время отключены.
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
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
  // «призрак» ещё EXIT_MS и схлопываем его CSS-ом (grid 1fr→0fr по обеим осям), чтобы
  // соседи по flex-wrap-ряду сдвигались влево плавно, а не скачком (см. useExitingListItems).
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
    <div className={className}>
      <div
        ref={setNodeRef}
        className={cn(
          // Мягкий жёлтый: amber с низкой насыщенностью, чтобы полка читалась как «тёплая
          // зона», а не как предупреждение. В тёмной теме — тот же оттенок в глубину.
          'relative rounded-xl border border-amber-300/50 bg-amber-100/45 px-2.5 py-2 transition-colors duration-150',
          'dark:border-amber-400/20 dark:bg-amber-400/[0.07]',
          isOver && 'border-amber-400/80 bg-amber-200/60 dark:border-amber-300/50 dark:bg-amber-400/[0.16]',
          flash && 'pf-shelf-flash',
        )}
      >
        {/* Без спиннера: крутящийся лоадер в заголовке читался как «идёт загрузка»,
            хотя это просто зона. Заголовок и жёлтый фон говорят всё сами. */}
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300/90">
          {/* Полка — это статус 'manual', и называться должна так же. «В работе» здесь
              было бы вторым смыслом того же слова: в сводках/TG/EOD «В работе» — это
              статус 'in_progress' (задача у воркера), а не «делаю руками». */}
          <span>{STATUS_LABEL.manual}</span>
          {items.length > 0 && <span className="tabular-nums opacity-70">{items.length}</span>}
        </div>
        {items.length === 0 && displayItems.length === 0 ? (
          <p className="px-0.5 py-1 text-xs text-amber-800/60 dark:text-amber-200/45">
            Перетащите сюда задачу, которой занимаетесь сейчас.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {displayItems.map(({ item, exiting }) => (
              // Обёртка-коллапс (аналог AcceptedCard/ApprovalItemCard, но по ОБЕИМ осям —
              // карточка живёт в flex-wrap-ряду, соседи по строке сдвигаются только когда
              // схлопывается именно ширина, а не высота). overflow — только на exit,
              // иначе на вспышке обрезался бы зелёный ring. data-pf-collapse — исключение
              // из pf-no-motion (globals.css): едет даже когда анимации на тач выключены.
              <div
                key={item.id}
                data-pf-collapse
                className="grid shrink-0 grow-0 transition-all duration-300 ease-out motion-reduce:transition-none"
                style={{
                  gridTemplateColumns: exiting ? '0fr' : '1fr',
                  gridTemplateRows: exiting ? '0fr' : '1fr',
                }}
              >
                <div className={cn('min-h-0 min-w-0', exiting ? 'overflow-hidden' : 'overflow-visible')}>
                  <div
                    // rounded-xl на обёртке — чтобы вспышка (::after с border-radius: inherit)
                    // повторяла скругление карточки. Фона и рамки у обёртки нет, видимого
                    // эффекта от радиуса самого по себе тоже. data-pf-collapse — ТОЖЕ на этом
                    // div'е (не только на внешнем grid-враппере выше): без него на тач
                    // pf-no-motion зануляет именно ЭТОТ opacity-transition (у него своя
                    // duration, отдельная от grid-схлопывания снаружи) — карточка гасла бы
                    // рывком, пока пустая коробка вокруг нее ещё 300мс едет схлопыванием
                    // (ревью этапа 3, Important).
                    data-pf-collapse
                    className={cn(
                      'group relative w-[17rem] max-w-full shrink-0 grow-0 rounded-xl transition-opacity duration-200 motion-reduce:transition-none',
                      flash && item.id === flashItemId && 'pf-card-flash',
                      exiting && 'pointer-events-none opacity-0',
                    )}
                  >
                    {/* Полка «В работе»: та же ловушка dnd-id, что и у ghost-групп выше —
                        item могли снять с полки (принята/удалена), а призрак ещё доигрывает
                        коллапс поверх уже отрисованной живой карточки этой же задачи в другом
                        месте доски. ghost={exiting} суффиксует dnd-id (см. draggableTaskId). */}
                    <DraggableTask
                      item={item}
                      disabled={!item.canModify || exiting}
                      ghost={exiting}
                      selecting={selecting}
                    >
                      <AcceptedCard
                        item={item}
                        onOpen={() => onOpen(item)}
                        onChanged={onChanged}
                        onDelete={() => onDelete(item)}
                        selecting={selecting}
                        selected={selectedIds?.has(item.id) ?? false}
                        {...(onSelectToggle ? { onSelectToggle } : {})}
                      />
                    </DraggableTask>
                    {item.canModify && !selecting && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveFromWork(item);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Убрать из работы (вернуть в «Черновики»)"
                        className="absolute -right-1.5 -top-1.5 z-20 grid size-5 place-items-center rounded-full border border-amber-300/70 bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 dark:border-amber-400/30"
                        aria-label="Убрать из работы"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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

// Кубик участника пространства = drop-цель смены ответственного. В покое — компактная ава + имя
// (ховер раскрывает карточку UserAvatarHover). Во время drag'а кубик получает тихий
// primary-ринг (сигнал «сюда можно»), а тот, что под курсором, плавно всплывает: лёгкий
// scale + сплошной ринг + подпись сменяется на «Назначить». Себя тут нет — «забрать себе»
// делается дропом на свою аву слева (SelfDropAvatar).
// filterActive/onToggleFilter — клик по кубику (не по хвостовой ×) переключает состояние,
// за которое отвечает вызывающий: у руководителя пространства это открытая доска входящих
// сотрудника, у остальных на вкладке «Для всех» — single-фильтр «кому» (спека 2026-07-13),
// общий с шапочным меню-фильтром.
function UserCube({
  member,
  dragging,
  filterActive = false,
  onToggleFilter,
  clearLabel = 'Снять фильтр',
  hint,
}: {
  member: SharedMember;
  dragging: boolean;
  filterActive?: boolean;
  onToggleFilter?: () => void;
  // Подпись хвостовой ×: «снять фильтр» у обычного участника, «вернуться к своим» у
  // руководителя, который смотрит чужие входящие.
  clearLabel?: string;
  // Что даёт клик — уходит в hover-подсказку аватара рядом с «перетащите, чтобы назначить».
  hint?: string;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `user-${member.id}`, data: { type: 'user', member } });
  // Клик-фильтр доступен только вне drag'а (в drag-режиме кубик — цель назначения, не
  // клик-таргет) и только когда проп передан (т.е. на вкладке «Другим», см. место рендера).
  const clickable = !dragging && !!onToggleFilter;
  return (
    <div
      ref={setNodeRef}
      onClick={clickable ? onToggleFilter : undefined}
      className={cn(
        // Крупный блок-плитка (задача 3a36e7e8): больше площадь → легче попасть при drag.
        'relative flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-200 ease-out',
        clickable && 'cursor-pointer',
        dragging
          ? isOver
            ? 'scale-105 border-primary bg-primary/10 text-primary shadow-md ring-2 ring-inset ring-primary'
            : 'border-primary/30 bg-primary/[0.06] text-foreground ring-1 ring-inset ring-primary/20'
          : filterActive
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {dragging ? (
        // Во время drag — без hover-тултипа (чтобы не мешал прицеливанию), просто ава.
        <UserAvatar
          displayName={member.displayName}
          avatarUrl={member.avatarUrl}
          className="size-7 shrink-0 text-[11px]"
        />
      ) : (
        <UserAvatarHover
          displayName={member.displayName}
          avatarUrl={member.avatarUrl}
          subtitle={`участник пространства · перетащите сюда задачу, чтобы назначить${
            hint ? ` · ${hint}` : ''
          }`}
          triggerClassName="size-7 text-[11px]"
        />
      )}
      <span className="max-w-[8rem] truncate font-medium">
        {dragging && isOver ? 'Назначить' : member.displayName}
      </span>
      {/* Активный фильтр — инлайновый × ВНУТРИ пилюли (не absolute: ряд аватаров в
          overflow-x-auto обрезал бы вынесенный badge — «крестик отображался фигово»).
          stopPropagation — клик по × снимает фильтр, не проваливаясь в onClick кубика. */}
      {!dragging && filterActive && onToggleFilter && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFilter();
          }}
          aria-label={clearLabel}
          title={clearLabel}
          className="-mr-1 ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// Своя ава = drop-цель «забрать себе» (стоит левее вкладок). В покое — обычная ава; во время
// drag'а — тихий ринг-сигнал, под курсором всплывает (scale + сплошной ринг) и над ней
// появляется плавающая подпись «Забрать себе». Дроп сюда идёт по тому же type:'user' с
// member.id === user.id — и для карточек доски, и блока (см. dropBoardTaskOnUser/handleDragEnd).
function SelfDropAvatar({
  user,
  dragging,
}: {
  user: { id: string; displayName: string; avatarUrl?: string | null };
  dragging: boolean;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `user-${user.id}`,
    data: {
      type: 'user',
      member: { id: user.id, displayName: user.displayName, email: '', avatarUrl: user.avatarUrl ?? null },
    },
  });
  return (
    <div ref={setNodeRef} className="relative shrink-0">
      {dragging && isOver && (
        <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-md">
          Забрать себе
        </span>
      )}
      <div
        className={cn(
          'rounded-full transition-all duration-200 ease-out',
          dragging && !isOver && 'ring-2 ring-primary/25 ring-offset-2 ring-offset-background',
          dragging && isOver && 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
      >
        <UserAvatar displayName={user.displayName} avatarUrl={user.avatarUrl} className="size-8 text-[11px]" />
      </div>
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
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
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

// Вкладки блока ответственных: «Для меня» / «Другим».
// Тихие текстовые табы в масштабе прежнего заголовка секции: активная — semibold +
// primary-пилюля счётчика, неактивная — muted с hover.
function AssigneeTabs({
  tab,
  onChange,
  toMeCount,
  byMeCount,
}: {
  tab: AssigneeTab;
  onChange: (t: AssigneeTab) => void;
  toMeCount: number;
  byMeCount: number;
}): React.ReactElement {
  return (
    // Без role=tablist/tab: полный ARIA-паттерн табов требует roving tabindex и
    // стрелочной навигации — вместо ложной семантики честные toggle-кнопки (aria-pressed).
    <div className="-ml-2 flex items-center gap-0.5">
      <TabButton
        active={tab === 'toMe'}
        label="Мои"
        count={toMeCount}
        onClick={() => onChange('toMe')}
      />
      <TabButton
        active={tab === 'byMe'}
        label="Для всех"
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
        // min-w-0 — на 320px лейбл таба ужимается truncate'ом, а не вылезает из бокса.
        'inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[15px] leading-tight tracking-tight transition-colors',
        active
          ? 'font-semibold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-hover hover:text-foreground',
      )}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          'inline-flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium leading-none tabular-nums',
          active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
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
            'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
            badgeCount > 0 && 'bg-hover text-foreground',
          )}
        >
          <Filter className="size-3.5" />
          <span className="hidden sm:inline">Фильтры</span>
          {badgeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold tabular-nums text-primary">
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
            <div className="mt-1 border-t px-2 pb-1 pt-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
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
              <div className="mt-1 flex items-center justify-between border-t px-3 pb-1 pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Фильтры
                </span>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={onResetFilters}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
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
      <span className="flex-1 text-left">Скрыть личные</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
          value ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground/70',
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
      <span className="flex-1 text-left">Скрыть выполненные</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
          value ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground/70',
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
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
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
        'max-w-[12rem] truncate rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-primary/30 bg-primary/10 font-medium text-primary'
          : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
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
// Принятая задача-карточка: чекбокс «выполнено» + описание + мета-бейджи, клик открывает drawer.
function AcceptedCard({
  item,
  onOpen,
  onChanged,
  onDelete,
  showCreatedAt = false,
  hideProjectLabel = false,
  selecting = false,
  selected = false,
  onSelectToggle,
  hideQuickActions = false,
}: {
  item: InboxBlockTask;
  onOpen: () => void;
  onChanged: () => void;
  onDelete: () => void;
  // При сортировке «по дате создания» показываем дату создания в мета-строке (по наведению).
  showCreatedAt?: boolean;
  // При сортировке «по проекту» колонка уже названа проектом — ярлык на карточке не нужен.
  hideProjectLabel?: boolean;
  // Режим выделения: клик тогает выбор вместо открытия дравера, действия карточки скрыты.
  selecting?: boolean;
  selected?: boolean;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  // Приёмка (db/150): в полке утверждения действия живут в явных кнопках «Принять» /
  // «Вернуть в работу», поэтому встроенные чекбокс и корзина только путают.
  hideQuickActions?: boolean;
}): React.ReactElement {
  const isDone = item.status === 'done';
  const { taskRepository } = useContainer();
  const { user: currentUser } = useCurrentUser();
  const { celebrate } = useCompletedToday();
  const { isUnread } = useUnreadTasks();
  // ПКМ по карточке = «выполнить»: карточка мигает зелёным, затем плавно схлопывается и
  // исчезает, и только после анимации коммитим move→done (визуально её уже нет — рефетч
  // ниже не даёт скачка). Фазы: idle → flash (вспышка) → exit (коллапс+затухание). Движок
  // фаз — общий хук useFlashExitPhase (см. его же в ApprovalItemCard ниже): в зависимостях
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
  // Заголовок/тело как на досках проектов: 1-я строка plain, тело компактным markdown, всё в
  // line-clamp-4 — видно только название (запросы 3, 4).
  const { title, body } = splitTitleBody(item.description ?? '');
  // Название проекта — всегда видимая пилюля в правом верхнем углу. Чужие личные входящие
  // подписываем владельцем («Личные · Денис Волков»): без имени задача выглядела бы своей,
  // хотя запись живёт у другого человека (статус и порядок у вас общие).
  const foreignInboxOwner =
    item.isInbox && item.inboxOwner && item.inboxOwner.userId !== currentUser?.id
      ? item.inboxOwner.displayName
      : null;
  const projectLabel = item.isInbox
    ? foreignInboxOwner
      ? `Личные · ${foreignInboxOwner}`
      : 'Личные'
    : item.projectName;

  // Кнопки действий (чекбокс + удалить). Рендерятся в ДВУХ раскладках: десктоп — плавающий
  // оверлей по hover, мобила — статичный ряд под текстом. big=true → тач-размер (size-9).
  // В режиме выделения действий нет: карточка целиком — цель выбора, а «выполнить»/«удалить»
  // на ней конфликтовали бы с кликом-тоглом (и есть в панели массовых действий).
  const renderActions = (big: boolean): React.ReactNode =>
    selecting || hideQuickActions ? null : (
    <>
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
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'shrink-0 cursor-pointer rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
            big ? 'size-9' : 'size-6',
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Удалить"
        >
          <Trash2 className={big ? 'size-4' : 'size-3'} />
        </Button>
      )}
    </>
  );

  // Мета-бейджи (дата/ответственный/коммиты/вложения/комменты/приоритет/срок). Десктоп —
  // нижний левый оверлей по hover, мобила — тот же контент в статичном нижнем ряду.
  const metaInner = (
    <>
      {/* Дата создания — при сортировке «по дате создания». */}
      {showCreatedAt && (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <CalendarDays className="size-3" />
          {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(item.createdAt)}
        </span>
      )}
      <AssigneeBadge assignee={item.assignee} />
      {(item.commitCount ?? 0) > 0 && (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-blue-600 dark:text-blue-400">
          <GitCommit className="size-3" />
          {item.commitCount}
        </span>
      )}
      {(item.attachmentCount ?? 0) > 0 && (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-emerald-600 dark:text-emerald-400">
          <ImageIcon className="size-3" />
          {item.attachmentCount}
        </span>
      )}
      {(item.commentCount ?? 0) > 0 && (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-violet-600 dark:text-violet-400">
          <MessageSquare className="size-3" />
          {item.commentCount}
        </span>
      )}
      <RalphModeBadge mode={item.ralphMode} />
      {item.priority !== null && item.priority !== undefined && (
        <PriorityBadge priority={item.priority} />
      )}
      {item.deadline ? (
        <DeadlineBadge deadline={item.deadline} status={item.status} />
      ) : (
        <span className="whitespace-nowrap text-muted-foreground/50">без срока</span>
      )}
    </>
  );

  return (
    // Обёртка-аниматор: плавный коллапс высоты (grid 1fr→0fr) + затухание при «выполнено».
    // overflow скрываем ТОЛЬКО на фазе exit — иначе на вспышке обрезался бы зелёный ring.
    // data-pf-collapse — исключение из pf-no-motion (globals.css): едет даже когда анимации
    // на тач выключены по умолчанию (MotionProvider), иначе на телефоне карточка исчезала бы
    // скачком и соседи снизу прыгали бы на её место без анимации.
    <div
      data-pf-collapse
      className={cn(
        // grid-cols-[minmax(0,1fr)] — не косметика: у единственной неявной колонки
        // размер `auto`, а её минимум = min-content содержимого. Карточка с неразрывным
        // куском шире колонки (длинное имя проекта в шапке, ряд nowrap-бейджей на узком
        // экране) раздвигала трек, вылезала за свои 17rem в полках и наезжала на соседнюю.
        // Замер: 400px вместо 272px; minmax(0,1fr) и min-w-0 ниже дают ровно 272px.
        'grid grid-cols-[minmax(0,1fr)] transition-all duration-300 ease-out motion-reduce:transition-none',
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
      // Вне режима выделения role/tabIndex приходят от dnd-kit на обёртке DraggableTask —
      // второй кнопки внутри кнопки не создаём. В режиме выделения атрибуты сняты, и
      // фокусируемость с ролью возвращает карточка.
      role={selecting ? 'button' : undefined}
      tabIndex={selecting ? 0 : undefined}
      aria-pressed={selectable ? selected : undefined}
      onContextMenu={completeByContextMenu}
      className={cn(
        'group relative flex cursor-pointer select-none flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-card transition-all duration-200 dark:border-white/[0.08]',
        isDone && 'border-success/20 bg-success/[0.06] hover:border-success/30',
        // Непрочитанная: синий неон по контуру. До состояний выбора/вспышки — те
        // временные и должны перебивать подсветку.
        !selecting && item.priority !== 1 && isUnread(item.id) && 'pf-unread',
        // Срочная: красное свечение. Перебивает синее — «сделай сейчас» важнее «посмотри».
        !selecting && item.priority === 1 && 'pf-urgent',
        // Выбор показываем ТОЛЬКО рамкой и кольцом. Кружок-отметку в левом верхнем углу
        // убрали: он повторял вид старого круглого чекбокса «готово» и читался как он.
        selected && 'border-primary ring-2 ring-primary/60',
        // Вспышка «выполнено»: мягкий зелёный + лёгкий pop.
        completePhase === 'flash' &&
          'scale-[1.02] border-emerald-500/60 bg-emerald-500/[0.12] ring-2 ring-emerald-500/50 dark:bg-emerald-500/[0.16]',
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
      {/* Аффорданс «Ctrl+клик = выполнить»: серый оверлей с зелёной галочкой поверх карточки,
          виден только при зажатом Ctrl и наведении. pointer-events-none — клик идёт в карточку. */}
      {(completeArmed || (completing && completeVeiled)) && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-30 items-center justify-center rounded-lg bg-zinc-500/30 backdrop-blur-[1px] transition-opacity duration-150 dark:bg-zinc-900/45',
            // Во время выполнения вуаль видна безусловно — не завязана на hover: при коллапсе
            // карточка уезжает из-под курсора, и hover-условие сняло бы её на полпути.
            completing
              ? 'flex opacity-100'
              : 'hidden opacity-0 group-hover:flex group-hover:opacity-100',
          )}
        >
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 transition-transform duration-200 ring-white/70 dark:ring-black/30',
              // Галочка на вспышке слегка «подпрыгивает», на уходе — сжимается вместе с карточкой.
              completePhase === 'flash' && 'scale-110',
              completePhase === 'exit' && 'scale-90',
            )}
          >
            <Check className="size-5" strokeWidth={3} />
          </span>
        </div>
      )}
      {/* Название проекта — полоса-заголовок. Скрываем при сортировке по проекту (колонка = проект). */}
      {!hideProjectLabel && (
        <div className="flex items-center justify-center gap-1 border-b border-black/[0.05] bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.02]">
          {item.isInbox ? (
            <InboxIcon className="size-2.5 shrink-0" />
          ) : (
            <FolderKanban className="size-2.5 shrink-0" />
          )}
          {/* min-w-0 — иначе flex-элемент не сжимается ниже min-content и truncate не
              срабатывает: длинное имя проекта просто обрезалось краем карточки без «…». */}
          <span className="min-w-0 truncate">{projectLabel}</span>
        </div>
      )}
      {/* Моб: колонка (текст сверху, ряд мета/действий снизу); десктоп — строка с
          плавающими оверлеями (как на доске проекта, см. KanbanCard). */}
      <div className="relative flex flex-col gap-1.5 px-2 py-2 sm:flex-row sm:items-start">
        {/* Действия — ДЕСКТОП: оверлей в правом верхнем углу (по hover/фокусу). На мобиле
            скрыт (hidden) — действия в статичном нижнем ряду (ниже), текст виден целиком. */}
        {!selecting && (
          <div
            className="pointer-events-none absolute right-1 top-4 z-20 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-card opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 sm:flex dark:ring-white/[0.08]"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {renderActions(false)}
          </div>
        )}
        <div className="min-w-0 flex-1">
        {item.description?.trim() ? (
          // Моб: весь текст задачи (line-clamp-none). Заголовок полужирный, как на доске.
          <div className="max-h-[4lh] overflow-hidden text-sm leading-snug max-sm:max-h-none">
            <TaskTitleText title={title} className="font-medium text-foreground" />
            {body.trim() && (
              <Markdown
                className={cn(
                  MARKDOWN_COMPACT,
                  '[&_h1]:font-normal [&_h2]:font-normal [&_h3]:font-normal [&_strong]:font-normal [&_b]:font-normal',
                )}
              >
                {body}
              </Markdown>
            )}
          </div>
        ) : (
          <p className="text-sm leading-snug text-muted-foreground">—</p>
        )}
      </div>
        {/* Параметры — ДЕСКТОП: нижний левый оверлей по hover. На мобиле скрыт (hidden). */}
        <div className="pointer-events-none absolute bottom-1 left-1 hidden max-w-[calc(100%-0.5rem)] items-center gap-1.5 overflow-hidden rounded-md bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 sm:flex dark:ring-white/[0.08]">
          {metaInner}
        </div>
        {/* Параметры/действия — МОБИЛА: статичный ряд под текстом (всегда виден, крупные кнопки).
            В режиме выделения ряд не перехватывает клики — тап по нему тогает выбор карточки,
            как и по остальной её площади (тач-протяжки нет, клик обязан работать везде). */}
        <div
          className="mt-0.5 flex items-center justify-between gap-2 border-t border-black/[0.05] pt-1 text-[11px] text-muted-foreground sm:hidden dark:border-white/[0.06]"
          {...(selecting
            ? {}
            : {
                onClick: (e: React.MouseEvent) => e.stopPropagation(),
                onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
                onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
              })}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">{metaInner}</span>
          {!selecting && (
            <span className="flex shrink-0 items-center gap-1">{renderActions(true)}</span>
          )}
        </div>
      </div>
    </div>
    </div>
    </div>
  );
}

