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
  Filter,
  Flag,
  FolderKanban,
  Hand,
  GitCommit,
  GripVertical,
  ImageIcon,
  Inbox as InboxIcon,
  ListFilter,
  MessageSquare,
  Send,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  type DelegationDirection,
} from './assignedGrouping';
import { ColumnPreviewList } from './ColumnPreview';
import { TaskTitleText } from './TaskTitleText';
import { splitTitleBody, plainTaskTitle } from '@/lib/taskTitleBody';
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';
import { InboxCheckbox } from './InboxCheckbox';
import { DelegationBadge } from './DelegationBadge';
import { PriorityBadge } from './PriorityBadge';
import { DeadlineBadge } from './DeadlineBadge';
import { RalphModeBadge } from './RalphMode';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';
import type { UnifiedDndRef } from './unifiedDndTypes';

type Props = {
  // Колбэк после accept/decline/toggle — InboxPage перефетчит доску ниже (принятые
  // задачи мёрджатся в inbox-список).
  onChanged?: () => void;
  // Режим отображения (как у страницы «Входящие»): 'kanban' — группы становятся колонками
  // канбана (карточки = поручения), 'list' — плоский список с заголовками групп.
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

// Тип вкладки блока делегирования: «Для меня» (поручено мне) / «Другим» (все видимые
// делегирования кому-то другому). Совпадает с направлением группировки.
type DelegationTab = DelegationDirection;

// done-задачи прячутся Eye-toggle'ом страницы; фильтр общий для обеих вкладок.
const notDone = (t: AssignedTask): boolean => t.status !== 'done';

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

// Блок делегирования на главной, две вкладки: «Для меня» — задачи, делегированные текущему
// пользователю по всем проектам; «Другим» — ВСЕ видимые делегирования кому-то другому
// (в именованных проектах-участниках — от любого любому, напр. «Олег → Ярослав»; в
// инбоксе — только собственные исходящие), с фильтрами «от кого / кому / проект»
// (по умолчанию все — видно, кто как справляется по всем проектам). Обе вкладки грузятся
// вместе (счётчики в табах всегда актуальны). Группировка списка переключаемая
// (проект/дата создания/дедлайн/приоритет) и сохраняется за аккаунтом (users.ui_prefs).
// Делегирование мгновенное (создаётся сразу accepted) — обе вкладки рисуют все строки в
// «принятом» виде (AcceptedCard с чекбоксом «выполнено»), без кнопок принятия/отказа;
// DelegationBadge показывает только направление для accepted-делегаций. Чекбокс доступен
// по роли caller'а (canModify с сервера). Клик по задаче открывает TaskDrawer (read-access
// гейтится на сервере).
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

export function AssignedToMeBlock({
  onChanged,
  toolbarSlot = null,
  hideDone = false,
  onHideDoneChange,
  bleedNegClass = '',
  bleedPadClass = '',
  externalDnd = null,
}: Props): React.ReactElement | null {
  const { taskDelegationRepository, taskRepository, userRepository, projectRepository } =
    useContainer();
  const { user } = useCurrentUser();
  // data — для фантомной колонки «Другой проект…» (условие «видны не все мои проекты»).
  const { data: allProjects } = useProjectsContext();
  const [tasks, setTasks] = useState<AssignedTask[]>([]); // «Для меня»
  const [byMeTasks, setByMeTasks] = useState<AssignedTask[]>([]); // «Другим»
  const [tab, setTab] = useState<DelegationTab>('toMe');
  // Фильтры вкладки «Другим»: от кого (creatorUserId) / кому (delegateUserId) /
  // проект (projectId). null = все (дефолт).
  const [filterFrom, setFilterFrom] = useState<string | null>(null);
  const [filterTo, setFilterTo] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<AssignedGrouping>(DEFAULT_ASSIGNED_GROUPING);
  // Персист гор. скролла ряда канбанов (по вкладке+группировке): старт слева, reload сохраняет.
  const { setRef: setHScrollRef, onScroll: onHScroll } = usePersistentScrollLeft(
    `pf:inbox-hscroll:${tab}:${grouping}`,
  );
  const [loading, setLoading] = useState(true);
  const [drawerTask, setDrawerTask] = useState<AssignedTask | null>(null);
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
      const [mine, byMe] = await Promise.all([
        taskDelegationRepository.listAssignedToMe(),
        taskDelegationRepository.listDelegatedToOthers(),
      ]);
      setTasks(mine);
      setByMeTasks(byMe);
    } catch (e) {
      toast.error(`Не удалось загрузить поручения: ${(e as Error).message}`);
    }
  }, [taskDelegationRepository]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Обе вкладки + сохранённую группировку грузим вместе и гейтим первый рендер на всё —
    // блок не «мигает» дефолтной группировкой/счётчиками перед применением реальных.
    Promise.all([
      taskDelegationRepository.listAssignedToMe(),
      taskDelegationRepository.listDelegatedToOthers(),
      userRepository.getUiPrefs(),
    ])
      .then(([mine, byMe, prefs]) => {
        if (cancelled) return;
        setTasks(mine);
        setByMeTasks(byMe);
        // Сортировка ПЕРСИСТИТСЯ за аккаунтом (users.ui_prefs) — при перезагрузке та же.
        // (Была session-only «точка 4» — юзер передумал 2026-07-11.)
        if (prefs.inboxAssignedGrouping) setGrouping(prefs.inboxAssignedGrouping);
        // Стартовая вкладка: «Для меня» пуста, а «Другим» — нет → открываем «Другим»,
        // чтобы блок не встречал пустым состоянием при живом контенте рядом. Решаем по
        // видимым (с учётом hide-done) спискам — тем же, что реально отрисуются.
        const mineShown = hideDoneRef.current ? mine.filter(notDone) : mine;
        const byMeShown = hideDoneRef.current ? byMe.filter(notDone) : byMe;
        if (mineShown.length === 0 && byMeShown.length > 0) setTab('byMe');
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

  // Фильтр hide-done — ДО группировок и счётчиков (зеркало TaskListView): done-задачи
  // остаются в data, скрытие только визуальное. Блок из одних выполненных исчезает
  // целиком; вернуть их — тем же Eye-toggle'ом, что и доску ниже.
  const toMeVisible = useMemo(() => (hideDone ? tasks.filter(notDone) : tasks), [tasks, hideDone]);
  const byMeVisibleAll = useMemo(
    () => (hideDone ? byMeTasks.filter(notDone) : byMeTasks),
    [byMeTasks, hideDone],
  );
  // Фильтры «от кого / кому / проект» — только вкладка «Другим», поверх hide-done.
  // Предикат вынесен: им же различаем причину пустоты (фильтры vs скрытые done).
  const matchesByMeFilters = useCallback(
    (t: AssignedTask): boolean =>
      (!filterFrom || t.delegation.creatorUserId === filterFrom) &&
      (!filterTo || t.delegation.delegateUserId === filterTo) &&
      (!filterProject || t.projectId === filterProject),
    [filterFrom, filterTo, filterProject],
  );
  const byMeVisible = useMemo(
    () => byMeVisibleAll.filter(matchesByMeFilters),
    [byMeVisibleAll, matchesByMeFilters],
  );
  const visibleTasks = tab === 'toMe' ? toMeVisible : byMeVisible;
  const anyByMeFilter = filterFrom !== null || filterTo !== null || filterProject !== null;
  // Опции фильтров — уникальные значения из СЫРОГО списка «Другим» (не из
  // отфильтрованного — иначе выбор значения выкидывал бы остальные из меню).
  const filterOptions = useMemo(() => {
    const from = new Map<string, string>();
    const to = new Map<string, string>();
    const projects = new Map<string, string>();
    for (const t of byMeTasks) {
      from.set(t.delegation.creatorUserId, t.delegation.creatorDisplayName);
      to.set(t.delegation.delegateUserId, t.delegation.delegateDisplayName);
      projects.set(t.projectId, t.isInbox ? 'Личные' : t.projectName);
    }
    const toArr = (m: Map<string, string>): { id: string; name: string }[] =>
      [...m.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { from: toArr(from), to: toArr(to), projects: toArr(projects) };
  }, [byMeTasks]);
  // Выбранное в фильтре значение исчезло из данных (делегации завершились/отозваны) —
  // сбрасываем этот фильтр, чтобы вкладка не выглядела пустой без причины.
  useEffect(() => {
    if (filterFrom && !byMeTasks.some((t) => t.delegation.creatorUserId === filterFrom)) {
      setFilterFrom(null);
    }
    if (filterTo && !byMeTasks.some((t) => t.delegation.delegateUserId === filterTo)) {
      setFilterTo(null);
    }
    if (filterProject && !byMeTasks.some((t) => t.projectId === filterProject)) {
      setFilterProject(null);
    }
  }, [byMeTasks, filterFrom, filterTo, filterProject]);
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
  const [activeDrag, setActiveDrag] = useState<AssignedTask | null>(null);
  // Идёт ЛЮБОЙ drag общего контекста (в external-режиме — и карточки доски снизу):
  // кубики людей подсвечиваются как цели для обоих происхождений. activeDrag при этом
  // остаётся только для СВОИХ карточек (оверлей-пилюля и родная end-логика).
  const [dragActive, setDragActive] = useState(false);
  // Дроп в «Будущее» не применяет срок сразу — открывает всплывашку выбора (неделя / конец
  // месяца / конкретный день). null = закрыта.
  const [futureDrop, setFutureDrop] = useState<AssignedTask | null>(null);

  // Оптимистично проставить дедлайн задаче в обоих списках («Для меня» / «Другим»).
  const patchDeadlineLocal = useCallback((id: string, deadline: string | null): void => {
    const patch = (arr: AssignedTask[]): AssignedTask[] =>
      arr.map((t) => (t.id === id ? { ...t, deadline } : t));
    setTasks(patch);
    setByMeTasks(patch);
  }, []);

  const applyDeadline = useCallback(
    async (item: AssignedTask, deadline: string | null): Promise<void> => {
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
  // drag-делегирования. Грузим один раз; себя список уже не содержит (сервер исключает).
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

  // Переназначить ответственного (drop карточки на кубик человека). Делегат — любой участник
  // пространства; после успеха — refresh.
  const reassignTo = useCallback(
    async (item: AssignedTask, member: SharedMember): Promise<void> => {
      if (member.id === item.delegation.delegateUserId) return; // уже на нём
      try {
        await taskRepository.reassign(item.projectId, item.id, member.id);
        toast.success(`Переназначено: ${member.displayName}`);
        await refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось переназначить: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged],
  );

  // Забрать задачу обратно себе (drop карточки на СВОЮ аватарку). Работает для задач, которые
  // делегировал я (вкладка «Другим») — закрываем активную делегацию (withdraw, сервер разрешает
  // и для accepted). Если задача уже назначена мне или делегировал не я — тихий тост.
  const reclaimToSelf = useCallback(
    async (item: AssignedTask): Promise<void> => {
      if (!user) return;
      if (item.delegation.delegateUserId === user.id) {
        toast.info('Задача уже назначена вам');
        return;
      }
      if (item.delegation.creatorUserId !== user.id) {
        toast.error('Забрать себе можно только задачу, которую делегировали вы');
        return;
      }
      try {
        await taskDelegationRepository.withdraw(item.delegation.id);
        toast.success('Задача возвращена вам');
        await refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось забрать: ${(e as Error).message}`);
      }
    },
    [user, taskDelegationRepository, refresh, onChanged],
  );

  const handleDragStart = (e: DragStartEvent): void => {
    setDragActive(true);
    const it = e.active.data.current?.item as AssignedTask | undefined;
    if (it) setActiveDrag(it);
  };
  const handleDragEnd = (e: DragEndEvent): void => {
    setActiveDrag(null);
    setDragActive(false);
    const over = e.over;
    const data = over?.data.current as
      | { type?: string; bucket?: string; member?: SharedMember }
      | undefined;
    const item = e.active.data.current?.item as AssignedTask | undefined;
    if (!over || !item || !data) return;
    // Дроп на кубик человека → переназначить делегата. Дроп на СВОЙ кубик → забрать себе.
    if (data.type === 'user' && data.member) {
      if (user && data.member.id === user.id) void reclaimToSelf(item);
      else void reassignTo(item, data.member);
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

  if (loading) return null;

  // #2: единая кнопка «Фильтры» в шапке страницы. Сортировка (когда есть поручения) +
  // скрыть-выполненные (всегда) + фильтры от/кому/проект (только вкладка «Другим»).
  const hasAny = toMeVisible.length > 0 || byMeVisibleAll.length > 0;
  const filtersPopover = (
    <InboxFiltersPopover
      showSort={hasAny}
      showFilters={hasAny && tab === 'byMe' && byMeTasks.length > 0}
      grouping={grouping}
      onGroupingChange={handleGroupingChange}
      hideDone={hideDone}
      onHideDoneChange={onHideDoneChange}
      options={filterOptions}
      from={filterFrom}
      to={filterTo}
      project={filterProject}
      onFrom={setFilterFrom}
      onTo={setFilterTo}
      onProject={setFilterProject}
      onResetFilters={() => {
        setFilterFrom(null);
        setFilterTo(null);
        setFilterProject(null);
      }}
    />
  );
  const filtersToolbar = toolbarSlot ? createPortal(filtersPopover, toolbarSlot) : null;

  // Блок скрыт, когда пусто В ОБЕИХ вкладках (с учётом hide-done): саму зону не рисуем, но
  // кнопку «Фильтры» (скрыть-выполненные для доски ниже) в шапке страницы оставляем.
  if (!hasAny) return filtersToolbar;

  const subtitleBase =
    tab === 'toMe' ? 'Задачи от других участников' : 'Поручения в ваших проектах';
  // Пустая видимая вкладка: сначала честно про фильтры, затем про скрытые done
  // (непустой СЫРОЙ список без фильтров = всё выполнено и скрыто Eye-toggle'ом),
  // и только при реально пустых данных — «ничего нет».
  const emptyText =
    tab === 'toMe'
      ? tasks.length > 0
        ? 'Все поручения выполнены и скрыты («Скрыть выполненные»)'
        : 'Вам сейчас ничего не поручено'
      : byMeTasks.length === 0
        ? 'Поручений пока нет'
        : anyByMeFilter && !byMeTasks.some(matchesByMeFilters)
          ? 'Под выбранные фильтры ничего не попадает'
          : // Фильтрам (если есть) в СЫРОМ списке что-то соответствует, но видимых нет —
            // значит, спрятал Eye-toggle, и говорим про него, а не виним фильтры.
            'Все подходящие поручения выполнены и скрыты («Скрыть выполненные»)';

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
              вернуть/назначить её себе (участники для делегирования — справа, без себя).
              size-8 крупнее аватаров в строках/карточках — иерархия масштабом. */}
          {user ? (
            <SelfDropAvatar user={user} dragging={dragActive} />
          ) : (
            <UserAvatar displayName="" className="size-8 text-[11px]" />
          )}
          <div className="min-w-0">
            {/* -ml-2 гасит внутренний px-2 первого таба — текст «Для меня» встаёт ровно
                там, где стоял бы обычный заголовок (и подзаголовок под ним). */}
            <DelegationTabs
              tab={tab}
              onChange={setTab}
              toMeCount={toMeVisible.length}
              // #3: бейдж «Другим» = РЕАЛЬНО отрисованный список (с учётом фильтров от/кому/
              // проект), а не сырой byMeVisibleAll — иначе при активном фильтре число на вкладке
              // расходилось с количеством видимых карточек («неверное количество»).
              byMeCount={byMeVisible.length}
            />
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitleBase}</p>
          </div>
        </div>
        {/* Кубики людей пространства — в ПРАВОМ крае строки с вкладками (цель drag-делегирования).
            Компактные аватары; при наведении перетаскиваемой задачи кубик раскрывается в
            «Делегировать: <имя>». Ряд горизонтально скроллится на узких экранах. self-center —
            вертикально по центру относительно более высокой левой группы (вкладки + подзаголовок). */}
        {members.length > 0 && (
          <div className="flex min-w-0 items-center gap-1.5 self-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {members.map((m) => (
              <UserCube key={m.id} member={m} dragging={dragActive} />
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
        // Drag между колонками меняет дедлайн; drag на аватар участника — делегирует. Ряд
        // колонок full-bleed'ится за паддинг страницы (как доска проекта).
        <div
          ref={setHScrollRef}
          onScroll={onHScroll}
          className={cn('flex snap-x gap-3 overflow-x-auto pb-2', bleedNegClass, bleedPadClass)}
        >
          {kanbanGroups.map((group) => (
            // Дроп-зона (drag-срок/делегирование) + пагинация «первые 4 + Показать ещё» +
            // перетаскиваемые карточки. Все три фичи вместе (мердж main ↔ feat/s2-usage).
            <TimeBucketColumn key={group.key} bucket={group.key} label={group.label} count={group.items.length}>
              {group.items.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground/45">Пусто</p>
              ) : (
                <ColumnPreviewList
                  // key по вкладке+фильтрам: смена датасета ремаунтит список и
                  // сбрасывает раскрытие «Показать ещё» (не тащим его между вкладками).
                  key={[tab, filterFrom ?? '', filterTo ?? '', filterProject ?? ''].join('|')}
                  items={group.items}
                  renderItem={(item) => (
                    <DraggableTask key={item.id} item={item} disabled={!item.canModify}>
                      <AcceptedCard
                        item={item}
                        currentUserId={user?.id ?? null}
                        onOpen={() => setDrawerTask(item)}
                        onChanged={handleToggled}
                      />
                    </DraggableTask>
                  )}
                />
              )}
            </TimeBucketColumn>
          ))}
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
          className={cn('flex snap-x gap-3 overflow-x-auto pb-2', bleedNegClass, bleedPadClass)}
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
          {/* «По дате создания»: в колонки нельзя (дату не изменить), но фантом принимает
              дроп — задача поручается вам и сама встаёт в колонку по своей дате. */}
          {boardDragActive && grouping === 'created' && (
            <PhantomDropColumn
              id="phantom-created"
              kind="created"
              icon={Hand}
              label="Забрать себе"
              hint="В колонки нельзя — дата создания не меняется. Бросьте сюда: задача будет поручена вам и встанет по своей дате"
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
              className="flex w-[86vw] max-w-[22rem] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-muted/20 dark:border-white/[0.10] dark:bg-white/[0.02] sm:w-72 sm:max-w-none"
            >
              <div className="flex items-center gap-1.5 border-b border-black/[0.06] bg-muted/50 px-2.5 py-1.5 text-xs font-semibold text-foreground/80 dark:border-white/[0.06] dark:bg-white/[0.04]">
                <GroupIcon mode={grouping} isInbox={group.isInbox} />
                <span className="truncate">{group.label}</span>
                <span className="ml-auto shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 p-1.5">
                {group.items.map((item) => (
                  <DraggableTask key={item.id} item={item} disabled={!item.canModify}>
                    <AcceptedCard
                      item={item}
                      currentUserId={user?.id ?? null}
                      onOpen={() => setDrawerTask(item)}
                      onChanged={handleToggled}
                      showCreatedAt={grouping === 'created'}
                      hideProjectLabel={grouping === 'project'}
                    />
                  </DraggableTask>
                ))}
              </div>
            </GroupDropColumn>
            );
          })}
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
          setDrawerTask(null);
          void refresh();
        }}
        onSubmit={handleDrawerSubmit}
        onCommitsChange={() => void refresh()}
        projectName={drawerTask && !drawerTask.isInbox ? drawerTask.projectName : undefined}
        isInbox={drawerTask?.isInbox ?? false}
        aiProjectId={drawerTask && !drawerTask.isInbox ? drawerTask.projectId : null}
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
    // (drag → делегирование) — общие drop-цели одного перетаскивания карточки.
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

// Оверлей перетаскивания карточки поручения. Компактный «комок» под курсором вместо целой
// карточки: стартует крупнее → пружиной сжимается в маленькую пилюлю с названием.
// ПОЛУПРОЗРАЧНЫЙ (~55%) — сквозь него видно кубик участника/колонку, на которую целишься
// (запрос: «видно, кому делегирую»). Мелкий оверлей = легче целиться (+ коллизии по курсору,
// см. dndCollision). Экспорт — его же рендерит InboxUnifiedDnd в общем контексте.
export function AssignedDragPill({ item }: { item: AssignedTask }): React.ReactElement {
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
        'flex w-[86vw] max-w-[22rem] shrink-0 snap-start flex-col rounded-xl bg-primary/[0.06] transition-shadow dark:bg-primary/[0.09] sm:w-72 sm:max-w-none sm:bg-primary/[0.04] sm:dark:bg-primary/[0.07]',
        isOver && 'ring-2 ring-inset ring-primary',
      )}
    >
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2.5 text-xs font-medium text-muted-foreground">
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
  kind: 'project' | 'priority' | 'created';
  icon: LucideIcon;
  label: string;
  hint: string;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: 'phantom', kind } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-40 shrink-0 snap-start flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-4 text-center transition-all duration-200 sm:w-44',
        isOver && 'scale-[1.02] border-primary bg-primary/[0.08]',
      )}
    >
      <Icon className={cn('size-5', isOver ? 'text-primary' : 'text-primary/60')} />
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <span className="text-[10px] leading-tight text-muted-foreground/70">{hint}</span>
    </div>
  );
}

// Обёртка-«ручка» drag'а вокруг карточки поручения. Клик (без сдвига ≥8px) проходит внутрь —
// открывается drawer / тогается чекбокс; долгий тап на мобиле стартует драг (см. sensors).
// disabled — нет прав менять задачу (canModify=false): карточка не таскается.
function DraggableTask({
  item,
  disabled,
  children,
}: {
  item: AssignedTask;
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

// Кубик участника пространства = drop-цель делегирования. В покое — компактная ава + имя
// (ховер раскрывает карточку UserAvatarHover). Во время drag'а кубик получает тихий
// primary-ринг (сигнал «сюда можно»), а тот, что под курсором, плавно всплывает: лёгкий
// scale + сплошной ринг + подпись сменяется на «Делегировать». Себя тут нет — «забрать себе»
// делается дропом на свою аву слева (SelfDropAvatar).
function UserCube({
  member,
  dragging,
}: {
  member: SharedMember;
  dragging: boolean;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `user-${member.id}`, data: { type: 'user', member } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] transition-all duration-200 ease-out',
        dragging
          ? isOver
            ? 'scale-[1.06] bg-primary/10 text-primary shadow-sm ring-2 ring-inset ring-primary'
            : 'bg-primary/[0.05] text-foreground ring-1 ring-inset ring-primary/20'
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
          subtitle="участник пространства · перетащите сюда задачу, чтобы делегировать"
          triggerClassName="size-6 text-[10px]"
        />
      )}
      <span className="max-w-[7rem] truncate font-medium">
        {dragging && isOver ? 'Делегировать' : member.displayName}
      </span>
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

// Вкладки блока делегирования: «Для меня» (поручено мне) / «Другим» (поручил я).
// Тихие текстовые табы в масштабе прежнего заголовка секции: активная — semibold +
// primary-пилюля счётчика, неактивная — muted с hover.
function DelegationTabs({
  tab,
  onChange,
  toMeCount,
  byMeCount,
}: {
  tab: DelegationTab;
  onChange: (t: DelegationTab) => void;
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
// не «летали» по строке: сортировка блока (когда есть поручения), тумблер «скрыть выполненные»
// (всегда — действует и на доску ниже) и фильтры От/Кому/Проект (только вкладка «Другим»).
// Инлайн-чипы/строки без вложенного DropdownMenu-портала — выбор не закрывает поповер.
function InboxFiltersPopover({
  showSort,
  showFilters,
  grouping,
  onGroupingChange,
  hideDone,
  onHideDoneChange,
  options,
  from,
  to,
  project,
  onFrom,
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
  options: {
    from: { id: string; name: string }[];
    to: { id: string; name: string }[];
    projects: { id: string; name: string }[];
  };
  from: string | null;
  to: string | null;
  project: string | null;
  onFrom: (v: string | null) => void;
  onTo: (v: string | null) => void;
  onProject: (v: string | null) => void;
  onResetFilters: () => void;
}): React.ReactElement {
  const activeFilterCount = showFilters ? [from, to, project].filter((v) => v !== null).length : 0;
  // Бейдж на кнопке = сколько «нестандартного» включено (фильтры + скрытие выполненных),
  // чтобы было видно активность, не открывая поповер. Сортировка — выбор, не «активный фильтр».
  const badgeCount = activeFilterCount + (hideDone ? 1 : 0);
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
          </div>

          {/* Сортировка блока «Поручено мне» — когда есть поручения (иначе вкладок нет). */}
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

          {/* Фильтры От/Кому/Проект — только вкладка «Другим». */}
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
                icon={Send}
                label="От кого"
                options={options.from}
                value={from}
                onChange={onFrom}
              />
              <InboxFilterSection
                icon={Users}
                label="Кому"
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

// Иконка колонки канбана «Поручено мне» по времени: без срока / на сегодня / будущее.
function TimeBucketIcon({ bucket }: { bucket: string }): React.ReactElement {
  if (bucket === 'none') return <CalendarOff className="size-3.5 shrink-0" />;
  if (bucket === 'future') return <CalendarDays className="size-3.5 shrink-0" />;
  return <CalendarClock className="size-3.5 shrink-0" />;
}

// === Карточки канбана (колонка = группа) ===
// Принятая задача-карточка: чекбокс «выполнено» + описание + мета-бейджи, клик открывает drawer.
function AcceptedCard({
  item,
  currentUserId,
  onOpen,
  onChanged,
  showCreatedAt = false,
  hideProjectLabel = false,
}: {
  item: AssignedTask;
  currentUserId: string | null;
  onOpen: () => void;
  onChanged: () => void;
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
  return (
    <div
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-card shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md dark:border-white/[0.08]',
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
      <div className="relative flex items-start gap-1.5 px-2 py-2">
        {/* Чекбокс — hover-оверлей слева-сверху (как на досках): в покое скрыт, текст на всю
            ширину; при наведении наслаивается на начало текста. На тач всегда виден. */}
        <div
          className="pointer-events-none absolute left-1 top-1 z-20 rounded-full bg-card opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 max-sm:pointer-events-auto max-sm:opacity-100 dark:ring-white/[0.08]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <InboxCheckbox
            task={item}
            lastDoneTaskId={null}
            lastTodoTaskId={null}
            onChanged={onChanged}
            disabled={!item.canModify}
          />
        </div>
        <div className="min-w-0 flex-1">
        {item.description?.trim() ? (
          <div className="line-clamp-4 text-sm leading-snug">
            <TaskTitleText title={title} />
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
      {/* Параметры (делегация/коммиты/вложения/комменты/приоритет/СРОК) — как на досках: локальная
          плашка снизу-слева, всплывает при наведении (запрос 4). Срок показываем ВСЕГДА (запрос 5). */}
      <div className="pointer-events-none absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1.5 overflow-hidden rounded-md bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100 dark:ring-white/[0.08]">
        {/* Дата создания — при сортировке «по дате создания» (запрос: показывать её по наведению). */}
        {showCreatedAt && (
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            <CalendarDays className="size-3" />
            {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(item.createdAt)}
          </span>
        )}
        {currentUserId && (
          <DelegationBadge delegation={item.delegation} currentUserId={currentUserId} />
        )}
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
        </div>
      </div>
    </div>
  );
}

