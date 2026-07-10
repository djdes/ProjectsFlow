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
  Check,
  Flag,
  FolderKanban,
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';
import type { SharedMember } from '@/application/project/ProjectRepository';
import { HttpError } from '@/lib/HttpError';
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
import { splitTitleBody } from '@/lib/taskTitleBody';
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';
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
  // DOM-узел в шапке страницы, куда портализуются фильтры (от/кому/проект) + «Сортировка».
  // null (нет слота) → рендерим их на месте, в шапке блока (фолбэк).
  toolbarSlot?: HTMLElement | null;
  // Скрыть выполненные (status='done'). Общий Eye-toggle страницы «Входящие» (persist в
  // localStorage) действует и на этот блок, и на доску ниже — одна кнопка на страницу.
  hideDone?: boolean;
  // Full-bleed классы (как у доски проекта): в kanban ряд колонок выносится за паддинг
  // страницы, чтобы отступы от краёв были такими же, как в проектах.
  bleedNegClass?: string;
  bleedPadClass?: string;
};

// Тип вкладки блока делегирования: «Для меня» (поручено мне) / «Другим» (все видимые
// делегирования кому-то другому). Совпадает с направлением группировки.
type DelegationTab = DelegationDirection;

// done-задачи прячутся Eye-toggle'ом страницы; фильтр общий для обеих вкладок.
const notDone = (t: AssignedTask): boolean => t.status !== 'done';

// «Ждёт моего ответа» во вкладке «Для меня»: обычное делегирование (pending) ИЛИ
// приглашение+делегирование (pending_invite — «Вступить/Отклонить»). Обе рисуются
// карточкой с кнопками действия, а не «принятой».
const isAwaitingResponse = (t: AssignedTask): boolean =>
  t.delegation.status === 'pending' || t.delegation.status === 'pending_invite';

// Коллизии по КУРСОРУ (pointerWithin) — целиться в мелкие кубики людей и колонки проще, чем
// «прямоугольником» всей карточки (дефолтный rectIntersection часто мазал мимо → «тяжело
// попасть»). Фолбэк на rectIntersection, когда курсор в зазоре между целями.
const dndCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

// Центрируем «комок»-оверлей на курсоре (аналог snapCenterToCursor из @dnd-kit/modifiers,
// который не установлен) — маленькая пилюля едет ровно под курсором, а не с отступом.
const snapToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
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
// «Для меня»: принятые — с чекбоксом «выполнено», ожидающие — с кнопками «Принять/
// Отклонить». «Другим»: все строки в «принятом» виде — DelegationBadge показывает
// направление и «ждёт ответа» для pending; чекбокс доступен по роли caller'а (canModify
// с сервера). Клик по задаче открывает TaskDrawer (read-access гейтится на сервере).
export function AssignedToMeBlock({
  onChanged,
  toolbarSlot = null,
  hideDone = false,
  bleedNegClass = '',
  bleedPadClass = '',
}: Props): React.ReactElement | null {
  const { taskDelegationRepository, taskRepository, userRepository, projectRepository } =
    useContainer();
  const { user } = useCurrentUser();
  // refresh списка проектов: при accept сервер помечает проект задачи favorite'ом — чтобы
  // секция «Избранное» в сайдбаре сразу его подхватила, перезагружаем список после принятия.
  const { refresh: refreshProjects } = useProjectsContext();
  const [tasks, setTasks] = useState<AssignedTask[]>([]); // «Для меня»
  const [byMeTasks, setByMeTasks] = useState<AssignedTask[]>([]); // «Другим»
  const [tab, setTab] = useState<DelegationTab>('toMe');
  // Фильтры вкладки «Другим»: от кого (creatorUserId) / кому (delegateUserId) /
  // проект (projectId). null = все (дефолт).
  const [filterFrom, setFilterFrom] = useState<string | null>(null);
  const [filterTo, setFilterTo] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<AssignedGrouping>(DEFAULT_ASSIGNED_GROUPING);
  const [loading, setLoading] = useState(true);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
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

  // Задача, которую переназначаем не-участнику проекта → всплывашка «пригласить?» (Фаза 3).
  const [inviteFlow, setInviteFlow] = useState<{ item: AssignedTask; member: SharedMember } | null>(
    null,
  );

  // Переназначить ответственного (drop карточки на кубик человека). Участник проекта →
  // просто меняем делегата. Не-участник проекта → сервер вернёт delegate_not_*; открываем
  // всплывашку «пригласить в проект и поручить?». После успеха — refresh (карточка может
  // уйти из «Для меня», сменить делегата в «Другим»).
  const reassignTo = useCallback(
    async (item: AssignedTask, member: SharedMember): Promise<void> => {
      if (member.id === item.delegation.delegateUserId) return; // уже на нём
      try {
        await taskRepository.reassign(item.projectId, item.id, member.id);
        toast.success(`Переназначено: ${member.displayName}`);
        await refresh();
        onChanged?.();
      } catch (e) {
        const code = e instanceof HttpError ? e.body.error : '';
        if (code === 'delegate_not_project_member' || code === 'delegate_not_in_shared_members') {
          setInviteFlow({ item, member }); // «его нет в проекте, пригласить?»
        } else {
          toast.error(`Не удалось переназначить: ${(e as Error).message}`);
        }
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

  // Подтвердил приглашение → создаём делегацию pending_invite (человек получит «Вступить/
  // Отклонить» во «Входящих»). Оптимизма нет — просто refresh (в «Другим» появится карточка
  // со статусом «ожидает вступления»).
  const confirmInvite = useCallback(
    async (item: AssignedTask, member: SharedMember): Promise<void> => {
      try {
        await taskRepository.inviteDelegate(item.projectId, item.id, member.id);
        toast.success(`${member.displayName} приглашён(а) — ждём ответа`);
        await refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось пригласить: ${(e as Error).message}`);
      } finally {
        setInviteFlow(null);
      }
    },
    [taskRepository, refresh, onChanged],
  );

  const handleDragStart = (e: DragStartEvent): void => {
    const it = e.active.data.current?.item as AssignedTask | undefined;
    if (it) setActiveDrag(it);
  };
  const handleDragEnd = (e: DragEndEvent): void => {
    setActiveDrag(null);
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

  if (loading) return null;
  // Блок скрыт, только когда пусто В ОБЕИХ вкладках (с учётом hide-done). Пустая
  // АКТИВНАЯ вкладка при живой соседней рисует тихий empty-state (табы должны остаться).
  if (toMeVisible.length === 0 && byMeVisibleAll.length === 0) return null;
  const pendingCount = visibleTasks.filter(isAwaitingResponse).length;
  // Русская плюрализация: 1/21/31 «ждёт ответа», иначе «ждут ответа» (11 — исключение).
  const pendingWord =
    pendingCount % 10 === 1 && pendingCount % 100 !== 11 ? 'ждёт ответа' : 'ждут ответа';
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

  return (
    // Один DndContext на всю зону: и временные колонки (drag → срок), и кубики людей
    // (drag → делегирование) — общие drop-цели одного перетаскивания карточки.
    <DndContext
      sensors={sensors}
      collisionDetection={dndCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
    {/* Персональная зона, Notion-стиль: НЕ карточка-в-рамке (рамка враждует с full-bleed
        канбана). «Это моё» несут три тихих сигнала: identity-шапка (свой аватар + настоящий
        заголовок + синяя count-пилюля + подзаголовок-контракт), шёпот-тинт primary на
        колонках канбана и hairline-линейка, замыкающая зону перед основной доской. */}
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
            {/* -ml-2 гасит внутренний px-2 первого таба — текст «Для меня» встаёт ровно
                там, где стоял бы обычный заголовок (и подзаголовок под ним). */}
            <DelegationTabs
              tab={tab}
              onChange={setTab}
              toMeCount={toMeVisible.length}
              byMeCount={byMeVisibleAll.length}
            />
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {subtitleBase}
              {pendingCount > 0 && ` · ${pendingCount} ${pendingWord}`}
            </p>
          </div>
          {/* Кубики людей пространства — ПРАВЕЕ вкладок (цель drag-делегирования). Компактные
              аватары; при наведении перетаскиваемой задачи кубик раскрывается в «Делегировать:
              <имя>». Ряд горизонтально скроллится на узких экранах, не тесня фильтры справа. */}
          {(user || members.length > 0) && (
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto pl-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* «Мой» кубик — drop сюда забирает задачу обратно себе (см. reclaimToSelf). */}
              {user && (
                <UserCube
                  key="__me"
                  member={{ id: user.id, displayName: user.displayName, email: '', avatarUrl: user.avatarUrl }}
                  dragging={activeDrag !== null}
                  isSelf
                />
              )}
              {members.map((m) => (
                <UserCube key={m.id} member={m} dragging={activeDrag !== null} />
              ))}
            </div>
          )}
        </div>
        {/* Фильтры (от/кому/проект, вкладка «Другим») + «Сортировка». По умолчанию порталятся
            в шапку страницы (toolbarSlot — строка с «Входящие»); фолбэк — на месте, в шапке блока. */}
        {(() => {
          const toolbar = (
            <>
              {tab === 'byMe' && byMeTasks.length > 0 && (
                <>
                  <DelegationFilterMenu
                    icon={Send}
                    prefix="От"
                    title="Фильтр: от кого поручено"
                    options={filterOptions.from}
                    value={filterFrom}
                    onChange={setFilterFrom}
                  />
                  <DelegationFilterMenu
                    icon={Users}
                    prefix="Кому"
                    title="Фильтр: кому поручено"
                    options={filterOptions.to}
                    value={filterTo}
                    onChange={setFilterTo}
                  />
                  <DelegationFilterMenu
                    icon={FolderKanban}
                    prefix="Проект"
                    title="Фильтр: проект"
                    options={filterOptions.projects}
                    value={filterProject}
                    onChange={setFilterProject}
                  />
                </>
              )}
              <GroupingMenu value={grouping} onChange={handleGroupingChange} />
            </>
          );
          return toolbarSlot ? (
            createPortal(toolbar, toolbarSlot)
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-1">{toolbar}</div>
          );
        })()}
      </div>

      {visibleTasks.length === 0 ? (
        // Пустая активная вкладка при живой соседней: тихая строка вместо пустых колонок.
        <p className="px-0.5 py-1 text-sm text-muted-foreground/60">{emptyText}</p>
      ) : grouping === 'deadline' ? (
        // Сортировка «по дедлайну» = 3 колонки по времени (Без срока / На сегодня / Будущее).
        // Drag между колонками меняет дедлайн; drag на аватар участника — делегирует. Ряд
        // колонок full-bleed'ится за паддинг страницы (как доска проекта).
        <div className={cn('flex snap-x gap-3 overflow-x-auto pb-2', bleedNegClass, bleedPadClass)}>
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
                    // «Принять/Отклонить»/«Вступить» — только у входящих pending/pending_invite
                    // («Для меня»); иначе «принятая» карточка (DelegationBadge покажет статус).
                    <DraggableTask key={item.id} item={item} disabled={!item.canModify}>
                      {tab === 'toMe' && isAwaitingResponse(item) ? (
                        <PendingCard
                          item={item}
                          busy={resolvingIds.has(item.delegation.id)}
                          onAccept={() => void resolve(item.delegation.id, 'accept')}
                          onDecline={() => void resolve(item.delegation.id, 'decline')}
                        />
                      ) : (
                        <AcceptedCard
                          item={item}
                          currentUserId={user?.id ?? null}
                          onOpen={() => setDrawerTask(item)}
                          onChanged={handleToggled}
                        />
                      )}
                    </DraggableTask>
                  )}
                />
              )}
            </TimeBucketColumn>
          ))}
        </div>
      ) : (
        // Прочие сортировки (проект / дата создания / приоритет): БОРДЕР-БЛОКИ — каждая группа
        // = карточка с заголовком-ярлыком и задачами ВНУТРИ (задачи одного проекта объединены в
        // один блок). Карточки перетаскиваемы → делегирование на аватар участника работает и тут.
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div
              key={group.key}
              className="overflow-hidden rounded-xl border border-black/[0.08] bg-muted/20 dark:border-white/[0.10] dark:bg-white/[0.02]"
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
                    {tab === 'toMe' && isAwaitingResponse(item) ? (
                      <PendingCard
                        item={item}
                        busy={resolvingIds.has(item.delegation.id)}
                        onAccept={() => void resolve(item.delegation.id, 'accept')}
                        onDecline={() => void resolve(item.delegation.id, 'decline')}
                      />
                    ) : (
                      <AcceptedCard
                        item={item}
                        currentUserId={user?.id ?? null}
                        onOpen={() => setDrawerTask(item)}
                        onChanged={handleToggled}
                        showCreatedAt={grouping === 'created'}
                      />
                    )}
                  </DraggableTask>
                ))}
              </div>
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
          // Full-bleed линия только когда показаны время-колонки (deadline); у бордер-блоков
          // ширина читаемой колонки.
          grouping === 'deadline' && bleedNegClass,
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
        item={futureDrop}
        onClose={() => setFutureDrop(null)}
        onPick={(deadline) => {
          const it = futureDrop;
          setFutureDrop(null);
          if (it) void applyDeadline(it, deadline);
        }}
      />

      {/* Дроп на не-участника проекта → «его нет в проекте, пригласить и поручить?». */}
      <InviteToDelegateDialog
        flow={inviteFlow}
        onClose={() => setInviteFlow(null)}
        onConfirm={confirmInvite}
      />
    </section>
    {/* Компактный «комок» под курсором вместо целой карточки: стартует крупнее → пружиной
        сжимается в маленькую пилюлю с названием. ПОЛУПРОЗРАЧНЫЙ (~55%) — сквозь него видно
        кубик участника/колонку, на которую целишься (запрос: «видно, кому делегирую»). Мелкий
        оверлей = легче целиться (+ коллизии по курсору, см. dndCollision). */}
    <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
      {activeDrag ? (
        <motion.div
          initial={{ scale: 1.25, opacity: 0.3 }}
          animate={{ scale: 1, opacity: 0.55 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 }}
          className="pointer-events-none flex max-w-[15rem] cursor-grabbing items-center gap-1.5 rounded-full border border-primary/40 bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-lg ring-1 ring-primary/20"
        >
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="truncate">
            {splitTitleBody(activeDrag.description ?? '').title || 'Задача'}
          </span>
        </motion.div>
      ) : null}
    </DragOverlay>
    </DndContext>
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
        isOver && 'ring-2 ring-inset ring-primary/50',
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
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: item.id,
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

// Кубик участника пространства = drop-цель делегирования. Показывает аву + ник (чтобы было
// понятно, кто это); при наведении (не во время drag) ава раскрывается в карточку «ава + имя»
// (UserAvatarHover). Во время перетаскивания задачи кубики подсвечиваются как цели, а тот, что
// под курсором, ПЛАВНО выделяется (scale + ring) и подписывается «Делегировать».
function UserCube({
  member,
  dragging,
  isSelf = false,
}: {
  member: SharedMember;
  dragging: boolean;
  // «Мой» кубик — drop забирает задачу себе, а не делегирует (подписи/акцент отличаются).
  isSelf?: boolean;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `user-${member.id}`, data: { type: 'user', member } });
  const overLabel = isSelf ? 'Забрать себе' : 'Делегировать';
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] transition-all duration-200 ease-out',
        dragging
          ? isOver
            ? 'scale-105 border-primary bg-primary/10 text-primary ring-2 ring-primary/50'
            : 'border-primary/25 bg-primary/[0.04] text-foreground'
          : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted',
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
          subtitle={
            isSelf
              ? 'перетащите сюда задачу, чтобы забрать её себе'
              : 'участник пространства · перетащите сюда задачу, чтобы делегировать'
          }
          triggerClassName="size-6 text-[10px]"
        />
      )}
      <span className="max-w-[7rem] truncate font-medium">
        {dragging && isOver ? overLabel : isSelf ? 'Я' : member.displayName}
      </span>
    </div>
  );
}

// Всплывашка выбора срока при дропе в «Будущее»: неделя / до конца месяца / конкретный день.
// Отмена (закрытие) — ничего не меняем, карточка остаётся где была.
function FutureDeadlineDialog({
  item,
  onClose,
  onPick,
}: {
  item: AssignedTask | null;
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
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
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

// Дроп задачи на кубик человека, которого нет в проекте → подтверждение «пригласить в
// проект и поручить?». Подтвердил → InviteAndDelegate (делегация pending_invite): человек
// получит «Вступить/Отклонить» во «Входящих». Отмена — ничего не делаем.
function InviteToDelegateDialog({
  flow,
  onClose,
  onConfirm,
}: {
  flow: { item: AssignedTask; member: SharedMember } | null;
  onClose: () => void;
  onConfirm: (item: AssignedTask, member: SharedMember) => void | Promise<void>;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const where =
    flow && !flow.item.isInbox ? `проект «${flow.item.projectName}»` : 'общие проекты';
  return (
    <Dialog open={flow !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Пригласить в проект?</DialogTitle>
        </DialogHeader>
        {flow && (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{flow.member.displayName}</span> ещё не
              в {where}. Пригласить и поручить задачу? Пока приглашение не принято, задача будет
              со статусом «ожидает вступления».
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Отмена
              </Button>
              <Button
                className="gap-1.5"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve(onConfirm(flow.item, flow.member)).finally(() =>
                    setBusy(false),
                  );
                }}
              >
                <Send className="size-4" />
                Пригласить
              </Button>
            </div>
          </>
        )}
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

// Фильтр вкладки «Другим» (от кого / кому / проект). Radio-меню (как GroupingMenu):
// «Все» + уникальные значения из данных. Пустая строка value = «Все» (radix не любит
// null). Активный фильтр подсвечен именем значения вместо «Все».
function DelegationFilterMenu({
  icon: Icon,
  prefix,
  title,
  options,
  value,
  onChange,
}: {
  icon: LucideIcon;
  prefix: string;
  title: string;
  options: readonly { readonly id: string; readonly name: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}): React.ReactElement {
  const currentName = value ? (options.find((o) => o.id === value)?.name ?? 'Все') : 'Все';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
            // Активный фильтр слегка «нажат» — видно и в icon-only режиме на мобиле.
            value !== null && 'bg-hover text-foreground',
          )}
          title={`${title} · сейчас: ${currentName}`}
        >
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{prefix}:</span>
          {/* На мобиле — только иконка (320px: табы + три меню не влезают со словами).
              Текущий выбор виден в title и в открытом radio-меню. */}
          <span className="hidden max-w-[8rem] truncate font-medium text-foreground sm:inline">
            {currentName}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(v) => onChange(v === '' ? null : v)}
        >
          <DropdownMenuRadioItem value="">Все</DropdownMenuRadioItem>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id}>
              {o.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
          title="Сортировка"
        >
          <ListFilter className="size-3.5" />
          <span className="hidden sm:inline">Сортировка:</span>
          {/* На мобиле — только иконка (см. PersonFilterMenu): текущий режим виден в
              title и отмечен в radio-меню. */}
          <span className="hidden max-w-[8rem] truncate font-medium text-foreground sm:inline">
            {ASSIGNED_GROUPING_LABELS[value]}
          </span>
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

// === Карточки канбана (колонка = группа) ===
// Принятая задача-карточка: чекбокс «выполнено» + описание + мета-бейджи, клик открывает drawer.
function AcceptedCard({
  item,
  currentUserId,
  onOpen,
  onChanged,
  showCreatedAt = false,
}: {
  item: AssignedTask;
  currentUserId: string | null;
  onOpen: () => void;
  onChanged: () => void;
  // При сортировке «по дате создания» показываем дату создания в мета-строке (по наведению).
  showCreatedAt?: boolean;
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
      {/* Название проекта — полоса-заголовок по центру, во всю ширину карточки (не тесним текст). */}
      <div className="flex items-center justify-center gap-1 border-b border-black/[0.05] bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.02]">
        {item.isInbox ? (
          <InboxIcon className="size-2.5 shrink-0" />
        ) : (
          <FolderKanban className="size-2.5 shrink-0" />
        )}
        <span className="truncate">{projectLabel}</span>
      </div>
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

// Ожидающая задача-карточка: «<аватар> Имя поручил вам», описание, кнопки Принять/Отклонить.
// Для pending_invite (приглашение в проект + задача) — текст «зовёт в проект» и кнопка «Вступить».
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
  const isInvite = item.delegation.status === 'pending_invite';
  const intro =
    isInvite && !item.isInbox
      ? `зовёт в проект «${item.projectName}» и поручает:`
      : 'поручил вам:';
  const acceptLabel = isInvite && !item.isInbox ? 'Вступить' : 'Принять';
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
            <span className="font-medium">{item.delegation.creatorDisplayName}</span> {intro}
          </p>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            <TaskTitleText title={splitTitleBody(item.description ?? '').title} className="text-xs" />
          </div>
        </div>
      </div>
      <div
        className="flex gap-1.5"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <Button
          size="sm"
          className="h-7 flex-1 gap-1 bg-success text-white hover:bg-success/90"
          disabled={busy}
          onClick={onAccept}
        >
          <Check className="size-3.5" />
          {acceptLabel}
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

