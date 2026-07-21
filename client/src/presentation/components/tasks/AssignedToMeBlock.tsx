import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { motion } from 'motion/react';
import {
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarRange,
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
  MessageSquare,
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
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
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
import { ColumnPreviewList } from './ColumnPreview';
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
import type { UnifiedDndRef } from './unifiedDndTypes';
import {
  asAssignedInboxBlockTask,
  buildToMeInboxBlockTasks,
  isPersonalInboxBlockTask,
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
  // Единый DnD «Входящих» (#5): если задан — блок НЕ рендерит свой DndContext/DragOverlay
  // (их даёт InboxUnifiedDnd на странице), а регистрирует свои хендлеры в этом реестре.
  externalDnd?: UnifiedDndRef | null;
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
// Экспорт (и snapToCursor ниже) — для InboxUnifiedDnd (общий контекст «Входящих»).
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
  externalDnd = null,
}: Props): React.ReactElement | null {
  const { taskAssigneeRepository, taskRepository, userRepository, projectRepository } =
    useContainer();
  const { user } = useCurrentUser();
  // data — для фантомной колонки «Другой проект…» (условие «видны не все мои проекты»).
  const { data: allProjects } = useProjectsContext();
  const [tasks, setTasks] = useState<AssignedTask[]>([]); // «Для меня»
  const [byMeTasks, setByMeTasks] = useState<AssignedTask[]>([]); // «Другим»
  // Личные (inbox) задачи коллег — отдельный источник, вливается во вкладку «Другим».
  // Сервер отдаёт их только по кругу общих рабочих пространств и всегда canModify: false.
  const [colleaguePersonalTasks, setColleaguePersonalTasks] = useState<AssignedTask[]>([]);
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

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [mine, byMe, personal] = await Promise.all([
        taskAssigneeRepository.listMine(),
        taskAssigneeRepository.listOthers(),
        taskAssigneeRepository.listColleaguesPersonal(),
      ]);
      setTasks(mine);
      setByMeTasks(byMe);
      setColleaguePersonalTasks(personal);
    } catch (e) {
      toast.error(`Не удалось загрузить задачи: ${(e as Error).message}`);
    }
  }, [taskAssigneeRepository]);

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

  // Удаление карточки блока — через тот же стильный диалог, что и на досках проектов
  // (не нативный confirm). handleDelete лишь открывает окно, удаляет confirmDelete.
  const handleDelete = (item: InboxBlockTask): void => {
    setDeleteTarget(item);
  };
  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      // projectId берём у самой задачи: в блоке лежат задачи из РАЗНЫХ проектов,
      // а не только из инбокса.
      await taskRepository.delete(deleteTarget.projectId, deleteTarget.id);
      toast.success('Задача удалена');
      // Личные задачи блока — зеркала карточек нижней доски, её тоже надо перечитать.
      if (isPersonalInboxBlockTask(deleteTarget)) {
        await externalDnd?.current.board?.refetch();
      }
      setDeleteTarget(null);
      handleToggled();
    } catch (err) {
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
    if (isPersonalInboxBlockTask(drawerTask)) {
      await externalDnd?.current.board?.refetch();
    }
    return updated;
  };

  // Фильтр hide-done — ДО группировок и счётчиков (зеркало TaskListView): done-задачи
  // остаются в data, скрытие только визуальное. Блок из одних выполненных исчезает
  // целиком; вернуть их — тем же Eye-toggle'ом, что и доску ниже.
  const toMeTasks = useMemo(
    () =>
      buildToMeInboxBlockTasks({
        assignedTasks: tasks,
        boardTasks: boardTasks ?? [],
        inboxProjectId,
        owner: user ? { id: user.id, displayName: user.displayName } : null,
      }),
    [tasks, boardTasks, inboxProjectId, user],
  );
  // Вкладка «Другим» = задачи, делегированные мной + личные доски коллег. Дедуп по id:
  // задача, которую я делегировал коллеге в ЕГО инбокс, приезжает из обоих источников.
  const byMeDisplayTasks = useMemo(() => {
    const seen = new Set(byMeTasks.map((t) => t.id));
    return [
      ...byMeTasks,
      ...colleaguePersonalTasks.filter((t) => !seen.has(t.id)),
    ].map(asAssignedInboxBlockTask);
  }, [byMeTasks, colleaguePersonalTasks]);
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
  const visibleTasks = tab === 'toMe' ? toMeVisible : byMeVisible;
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
      projects.set(t.projectId, t.isInbox ? `Личные · ${t.assignee.displayName}` : t.projectName);
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
  const groups = useMemo(
    () => groupAssignedTasks(visibleTasks, grouping, new Date(), tab),
    [visibleTasks, grouping, tab],
  );
  // Канбан блока — всегда РОВНО 3 колонки по времени (Без срока / На сегодня /
  // Будущее), независимо от выбранной группировки. Колонки всегда все три, даже пустые.
  const kanbanGroups = useMemo(() => groupAssignedByTime(visibleTasks, new Date()), [visibleTasks]);

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
      if (isPersonalInboxBlockTask(item)) {
        try {
          const board = externalDnd?.current.board;
          if (board) await board.updateTask(item.id, { deadline });
          else await taskRepository.update(item.projectId, item.id, { deadline });
        } catch (e) {
          toast.error(`Не удалось изменить срок: ${(e as Error).message}`);
        }
        return;
      }
      patchDeadlineLocal(item.id, deadline); // оптимистично — карточка сразу переезжает
      try {
        await taskRepository.update(item.projectId, item.id, { deadline });
      } catch (e) {
        patchDeadlineLocal(item.id, prev); // откат при ошибке
        toast.error(`Не удалось изменить срок: ${(e as Error).message}`);
      }
    },
    [externalDnd, patchDeadlineLocal, taskRepository],
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
        await externalDnd?.current.board?.refetch();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось переназначить: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, externalDnd, onChanged],
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
        await externalDnd?.current.board?.refetch();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось забрать: ${(e as Error).message}`);
      }
    },
    [user, taskRepository, refresh, externalDnd, onChanged],
  );

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
      | { type?: string; bucket?: string; member?: SharedMember }
      | undefined;
    const item = e.active.data.current?.item as InboxBlockTask | undefined;
    if (!over || !item || !data) return;
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

  // === Единый DnD «Входящих» (#5): регистрация в реестре общего контекста. ===
  // Без deps — пере-запись каждый рендер, чтобы замыкания хендлеров видели свежий стейт.
  useEffect(() => {
    if (!externalDnd) return;
    externalDnd.current.block = {
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
      onDragCancel: handleDragCancel,
      refresh,
    };
  });
  // Снятие регистрации — только на unmount (реестр в ref у InboxPage переживает ремаунты).
  useEffect(() => {
    if (!externalDnd) return;
    const registry = externalDnd.current;
    return () => {
      registry.block = null;
    };
  }, [externalDnd]);

  if (loading || boardTasks === null) return null;

  // #2: единая кнопка «Фильтры» в шапке страницы. Сортировка (когда есть задачи) +
  // скрыть-выполненные (всегда) + фильтры ответственного/проекта (только вкладка «Другим»).
  const hasAny = toMeVisible.length > 0 || byMeVisibleAll.length > 0;
  const filtersPopover = (
    <InboxFiltersPopover
      showSort={hasAny}
      showFilters={hasAny && tab === 'byMe' && byMeTasks.length > 0}
      grouping={grouping}
      onGroupingChange={handleGroupingChange}
      hideDone={hideDone}
      onHideDoneChange={onHideDoneChange}
      // «Скрыть личные» — только там, где личные доски коллег реально мешают.
      showHidePersonal={tab === 'byMe'}
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

  const subtitleBase = tab === 'toMe' ? 'Задачи, за которые отвечаете вы' : 'Задачи других участников';
  // Пустая видимая вкладка: сначала честно про фильтры, затем про скрытые done
  // (непустой СЫРОЙ список без фильтров = всё выполнено и скрыто Eye-toggle'ом),
  // и только при реально пустых данных — «ничего нет».
  const emptyText =
    tab === 'toMe'
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
      <div className="flex items-start justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Своя ава (владелец зоны) — И drop-цель «забрать себе»: перетащи задачу сюда, чтобы
              вернуть/назначить её себе (остальные участники — справа).
              size-8 крупнее аватаров в строках/карточках — иерархия масштабом. */}
          {user ? (
            <SelfDropAvatar user={user} dragging={dragActive} />
          ) : (
            <UserAvatar displayName="" className="size-8 text-[11px]" />
          )}
          <div className="min-w-0">
            {/* -ml-2 гасит внутренний px-2 первого таба — текст «Для меня» встаёт ровно
                там, где стоял бы обычный заголовок (и подзаголовок под ним). */}
            <AssigneeTabs
              tab={tab}
              onChange={handleTabChange}
              toMeCount={toMeVisible.length}
              // #3: бейдж «Другим» = РЕАЛЬНО отрисованный список (с учётом фильтров от/кому/
              // проект), а не сырой byMeVisibleAll — иначе при активном фильтре число на вкладке
              // расходилось с количеством видимых карточек («неверное количество»).
              byMeCount={byMeVisible.length}
            />
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitleBase}</p>
          </div>
        </div>
        {/* Кубики людей пространства — в ПРАВОМ крае строки с вкладками (цель drag-назначения).
            Компактные аватары; при наведении перетаскиваемой задачи кубик раскрывается в
            «Назначить: <имя>». Ряд горизонтально скроллится на узких экранах. self-center —
            вертикально по центру относительно более высокой левой группы (вкладки + подзаголовок). */}
        {members.length > 0 && (
          <div className="flex min-w-0 items-center gap-1.5 self-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {members.map((m) => (
              <UserCube
                key={m.id}
                member={m}
                dragging={dragActive}
                // Клик-фильтр «кому» — только на вкладке «Другим» (спека 2026-07-13); на
                // «Для меня» пропы не передаём, кубик остаётся только drop-целью.
                {...(tab === 'byMe'
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
        {/* Единая кнопка «Фильтры» порталится в шапку страницы (toolbarSlot). Фолбэк (нет
            слота) — рендерим на месте, в шапке блока. Сам портал отдаётся из return ниже. */}
        {!toolbarSlot && (
          <div className="flex flex-wrap items-center justify-end gap-1 self-center">{filtersPopover}</div>
        )}
      </div>

      {visibleTasks.length === 0 ? (
        // Пустая активная вкладка при живой соседней: тихая строка вместо пустых колонок.
        <p className="px-0.5 py-1 text-sm text-muted-foreground/60">{emptyText}</p>
      ) : grouping === 'deadline' ? (
        // Сортировка «по дедлайну» = 3 колонки по времени (Без срока / На сегодня / Будущее).
        // Drag между колонками меняет дедлайн; drag на аватар участника — назначает его. Ряд
        // колонок full-bleed'ится за паддинг страницы (как доска проекта).
        <div
          ref={setHScrollRef}
          onScroll={onHScroll}
          className={cn(
            // Как у основной доски: каждая колонка заканчивается под своей последней
            // задачей, а не растягивается до высоты самой длинной соседней колонки.
            'flex items-start snap-x snap-mandatory sm:snap-none gap-3 overflow-x-auto overscroll-x-none pb-2',
            bleedNegClass,
            bleedPadClass,
          )}
        >
          {kanbanGroups.map((group) => (
            // Дроп-зона (drag-срок/ответственный) + пагинация «первые 4 + Показать ещё» +
            // перетаскиваемые карточки. Все три фичи вместе (мердж main ↔ feat/s2-usage).
            <TimeBucketColumn key={group.key} bucket={group.key} label={group.label} count={group.items.length}>
              {group.items.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground/45">Пусто</p>
              ) : (
                <ColumnPreviewList
                  // key по вкладке+фильтрам: смена датасета ремаунтит список и
                  // сбрасывает раскрытие «Показать ещё» (не тащим его между вкладками).
                  key={[tab, filterTo ?? '', filterProject ?? ''].join('|')}
                  items={group.items}
                  renderItem={(item) => (
                    <DraggableTask key={item.id} item={item} disabled={!item.canModify}>
                      <AcceptedCard
                        item={item}
                        onOpen={() => setDrawerTask(item)}
                        onChanged={handleToggled}
                        onDelete={() => handleDelete(item)}
                      />
                    </DraggableTask>
                  )}
                />
              )}
            </TimeBucketColumn>
          ))}
          {/* Хвостовой спейсер (моб): последняя колонка доскролливается до ЦЕНТРА. */}
          <div aria-hidden className="w-16 shrink-0 sm:hidden" />
        </div>
      ) : (
        // Прочие сортировки (проект / дата создания / приоритет): горизонтальные КОЛОНКИ-канбаны —
        // каждая группа = колонка-бордер с заголовком-ярлыком и задачами внутри (задачи одного
        // проекта в одной колонке). Всегда канбан, никаких списков. Ряд full-bleed за паддинг.
        // Пока тащат карточку С ДОСКИ (boardDragActive) колонки становятся drop-целями по
        // смыслу сортировки, а первой в ряду появляется фантомная колонка (см. план
        // inbox-grouped-dnd): «Другой проект…» / инфо «Сюда нельзя» / «Другой приоритет…».
        <div
          ref={setHScrollRef}
          onScroll={onHScroll}
          className={cn(
            'flex items-start snap-x snap-mandatory sm:snap-none gap-3 overflow-x-auto overscroll-x-none pb-2',
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
          {groups.map((group) => {
            // Смысл дропа карточки доски на колонку: project → перенос задачи в проект
            // («Личные» — не цель, задача и так в инбоксе); priority → смена приоритета;
            // created — колонки не принимают (дату создания не изменить).
            const dropData =
              grouping === 'project' && !group.isInbox
                ? { type: 'group', grouping: 'project', projectId: group.key }
                : grouping === 'priority'
                  ? { type: 'group', grouping: 'priority', priority: group.key }
                  : null;
            return (
            <GroupDropColumn
              key={group.key}
              id={`group-${grouping}-${group.key}`}
              data={dropData}
              highlight={boardDragActive}
              className="flex w-[86vw] max-w-[22rem] shrink-0 snap-center snap-always flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-muted/20 dark:border-white/[0.10] dark:bg-white/[0.02] sm:w-72 sm:max-w-none"
            >
              <div className="flex items-center gap-1.5 border-b border-black/[0.06] bg-muted/50 px-2.5 py-1.5 text-xs font-semibold text-foreground/80 dark:border-white/[0.06] dark:bg-white/[0.04]">
                <GroupIcon mode={grouping} isInbox={group.isInbox} />
                <span className="truncate">{group.label}</span>
                <span className="ml-auto shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 p-1.5">
                {/* Каппинг «первые 4 + Показать ещё» (на тач включён по умолчанию) — иначе
                    колонка рендерит все свои карточки и вешает скролл на мобиле. */}
                <ColumnPreviewList
                  key={[grouping, group.key].join('|')}
                  items={group.items}
                  renderItem={(item) => (
                    <DraggableTask key={item.id} item={item} disabled={!item.canModify}>
                      <AcceptedCard
                        item={item}
                        onOpen={() => setDrawerTask(item)}
                        onChanged={handleToggled}
                        onDelete={() => handleDelete(item)}
                        showCreatedAt={grouping === 'created'}
                        hideProjectLabel={grouping === 'project'}
                      />
                    </DraggableTask>
                  )}
                />
              </div>
            </GroupDropColumn>
            );
          })}
          {/* Хвостовой спейсер (моб): последняя колонка доскролливается до ЦЕНТРА. */}
          <div aria-hidden className="w-16 shrink-0 sm:hidden" />
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
          const refreshBoard = drawerTask && isPersonalInboxBlockTask(drawerTask);
          setDrawerTask(null);
          void refresh();
          if (refreshBoard) void externalDnd?.current.board?.refetch();
        }}
        onSubmit={handleDrawerSubmit}
        onCommitsChange={() => void refresh()}
        projectName={drawerTask && !drawerTask.isInbox ? drawerTask.projectName : undefined}
        isInbox={drawerTask?.isInbox ?? false}
        aiProjectId={drawerTask && !drawerTask.isInbox ? drawerTask.projectId : null}
      />

      {/* Удаление карточки из hover-панели — тот же диалог, что и на досках проектов. */}
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        taskLabel={deleteTarget ? plainTaskTitle(deleteTarget.description ?? '') : null}
        onConfirm={() => void confirmDelete()}
        busy={deleting}
      />

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

      {/* Дроп на кубик другого участника → подтверждение смены ответственного. Тот же
          диалог используется карточками нижней доски через InboxUnifiedDnd. */}
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

  // External-режим (инбокс): DndContext и DragOverlay рендерит InboxUnifiedDnd на странице
  // (хендлеры зарегистрированы эффектом выше), блок отдаёт тело + портал кнопки «Фильтры».
  if (externalDnd)
    return (
      <>
        {filtersToolbar}
        {body}
      </>
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
// см. dndCollision). Экспорт — его же рендерит InboxUnifiedDnd в общем контексте.
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

// Колонка канбана «по времени» = drop-зона. При наведении таскаемой карточки колонка
// подсвечивается (ring), сигналя, что дроп сменит срок на этот бакет.
function TimeBucketColumn({
  bucket,
  label,
  count,
  children,
}: {
  bucket: string;
  label: string;
  count: number;
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
        <span className="shrink-0 text-muted-foreground/60">{count}</span>
      </div>
      <div className="flex min-h-[3rem] flex-col gap-2 px-2 pb-2">{children}</div>
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
  children,
}: {
  id: string;
  data: Record<string, unknown> | null;
  highlight: boolean;
  className: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id, data: data ?? {}, disabled: data === null });
  return (
    <div
      ref={setNodeRef}
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
// (диспетчер InboxUnifiedDnd, data {type:'phantom', kind}).
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

// Обёртка-«ручка» drag'а вокруг карточки задачи. Клик (без сдвига ≥8px) проходит внутрь —
// открывается drawer / тогается чекбокс; долгий тап на мобиле стартует драг (см. sensors).
// disabled — нет прав менять задачу (canModify=false): карточка не таскается.
function DraggableTask({
  item,
  disabled,
  children,
}: {
  item: InboxBlockTask;
  disabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  // id с префиксом: в едином контексте «Входящих» та же задача может одновременно висеть
  // карточкой на доске снизу (useSortable с голым task.id) — двум draggable нельзя делить id.
  // Хендлеры блока id не используют (читают data.item), так что префикс безопасен всегда.
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `assigned-${item.id}`,
    data: { type: 'task', item },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(!disabled && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-30')}
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
// filterActive/onToggleFilter (спека 2026-07-13, только вкладка «Другим») — клик по кубику
// (не по хвостовой ×) переключает single-фильтр «кому», общий с шапочным меню-фильтром.
function UserCube({
  member,
  dragging,
  filterActive = false,
  onToggleFilter,
}: {
  member: SharedMember;
  dragging: boolean;
  filterActive?: boolean;
  onToggleFilter?: () => void;
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
        'relative flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] transition-all duration-200 ease-out',
        clickable && 'cursor-pointer',
        dragging
          ? isOver
            ? 'scale-[1.06] bg-primary/10 text-primary shadow-sm ring-2 ring-inset ring-primary'
            : 'bg-primary/[0.05] text-foreground ring-1 ring-inset ring-primary/20'
          : filterActive
            ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/30'
            : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {dragging ? (
        // Во время drag — без hover-тултипа (чтобы не мешал прицеливанию), просто ава.
        <UserAvatar
          displayName={member.displayName}
          avatarUrl={member.avatarUrl}
          className="size-6 shrink-0 text-[10px]"
        />
      ) : (
        <UserAvatarHover
          displayName={member.displayName}
          avatarUrl={member.avatarUrl}
          subtitle="участник пространства · перетащите сюда задачу, чтобы назначить"
          triggerClassName="size-6 text-[10px]"
        />
      )}
      <span className="max-w-[7rem] truncate font-medium">
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
          aria-label="Снять фильтр"
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
// нужно (только open/onPick) — переиспользуется InboxUnifiedDnd'ом и для задач доски.
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
// для обоих происхождений драга: карточки блока «Входящих» (AssignedToMeBlock) и карточки
// нижней доски (InboxUnifiedDnd → dropBoardTaskOnUser) — чтобы дроп на один и тот же кубик
// вёл себя одинаково. Название задачи + переход «текущий → новый ответственный» с аватарами
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
        label="Для меня"
        count={toMeCount}
        onClick={() => onChange('toMe')}
      />
      <TabButton
        active={tab === 'byMe'}
        label="Другим"
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
}: {
  item: InboxBlockTask;
  onOpen: () => void;
  onChanged: () => void;
  onDelete: () => void;
  // При сортировке «по дате создания» показываем дату создания в мета-строке (по наведению).
  showCreatedAt?: boolean;
  // При сортировке «по проекту» колонка уже названа проектом — ярлык на карточке не нужен.
  hideProjectLabel?: boolean;
}): React.ReactElement {
  const isDone = item.status === 'done';
  // Заголовок/тело как на досках проектов: 1-я строка plain, тело компактным markdown, всё в
  // line-clamp-4 — видно только название (запросы 3, 4).
  const { title, body } = splitTitleBody(item.description ?? '');
  // Название проекта — всегда видимая пилюля в правом верхнем углу (инбокс → «Личные»).
  const projectLabel = item.isInbox ? 'Личные' : item.projectName;

  // Кнопки действий (чекбокс + удалить). Рендерятся в ДВУХ раскладках: десктоп — плавающий
  // оверлей по hover, мобила — статичный ряд под текстом. big=true → тач-размер (size-9).
  const renderActions = (big: boolean): React.ReactNode => (
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
    <div
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-card transition-colors duration-150 dark:border-white/[0.08]',
        isDone && 'border-success/20 bg-success/[0.06] hover:border-success/30',
      )}
      onClick={onOpen}
    >
      {/* Название проекта — полоса-заголовок. Скрываем при сортировке по проекту (колонка = проект). */}
      {!hideProjectLabel && (
        <div className="flex items-center justify-center gap-1 border-b border-black/[0.05] bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.02]">
          {item.isInbox ? (
            <InboxIcon className="size-2.5 shrink-0" />
          ) : (
            <FolderKanban className="size-2.5 shrink-0" />
          )}
          <span className="truncate">{projectLabel}</span>
        </div>
      )}
      {/* Моб: колонка (текст сверху, ряд мета/действий снизу); десктоп — строка с
          плавающими оверлеями (как на доске проекта, см. KanbanCard). */}
      <div className="relative flex flex-col gap-1.5 px-2 py-2 sm:flex-row sm:items-start">
        {/* Действия — ДЕСКТОП: оверлей в правом верхнем углу (по hover/фокусу). На мобиле
            скрыт (hidden) — действия в статичном нижнем ряду (ниже), текст виден целиком. */}
        <div
          className="pointer-events-none absolute right-1 top-4 z-20 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-card opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 sm:flex dark:ring-white/[0.08]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {renderActions(false)}
        </div>
        <div className="min-w-0 flex-1">
        {item.description?.trim() ? (
          // Моб: весь текст задачи (line-clamp-none). Заголовок полужирный, как на доске.
          <div className="line-clamp-4 max-sm:line-clamp-none text-sm leading-snug">
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
        {/* Параметры/действия — МОБИЛА: статичный ряд под текстом (всегда виден, крупные кнопки). */}
        <div
          className="mt-0.5 flex items-center justify-between gap-2 border-t border-black/[0.05] pt-1 text-[11px] text-muted-foreground sm:hidden dark:border-white/[0.06]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">{metaInner}</span>
          <span className="flex shrink-0 items-center gap-1">{renderActions(true)}</span>
        </div>
      </div>
    </div>
  );
}

