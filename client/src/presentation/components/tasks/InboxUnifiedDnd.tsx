import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Project } from '@/domain/project/Project';
import type { SharedMember } from '@/application/project/ProjectRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { plainTaskTitle } from '@/lib/taskTitleBody';
import { MEASURING_CONFIG } from './KanbanBoard';
import {
  AssignedDragPill,
  TaskDragPill,
  FutureDeadlineDialog,
  dndCollision,
  snapToCursor,
} from './AssignedToMeBlock';
import { startOfDay, ymd } from './assignedGrouping';
import type { UnifiedDndRef } from './unifiedDndTypes';

type Props = {
  // Реестр хендлеров/операций детей (доска + блок). Живёт в ref у InboxPage — стабильная
  // ссылка переживает ремаунты KanbanBoard (key={refetchKey}).
  registry: UnifiedDndRef;
  // id inbox-проекта — для delegate/reassign задач доски (у domain Task нет projectId).
  projectId: string;
  children: React.ReactNode;
};

// Происхождение активного drag'а: доска кладёт в data ключ `task` (KanbanCard/useSortable),
// блок делегирования — ключ `item` (DraggableTask/useDraggable). Оба с type:'task'.
type ActiveDrag = { origin: 'board'; task: Task } | { origin: 'block'; item: AssignedTask };

function detectActive(active: Active | null): ActiveDrag | null {
  const data = active?.data.current as { type?: string; task?: Task; item?: AssignedTask } | undefined;
  if (data?.type !== 'task') return null;
  if (data.task) return { origin: 'board', task: data.task };
  if (data.item) return { origin: 'block', item: data.item };
  return null;
}

// Полезная нагрузка over-целей: колонки доски / время-бакеты / кубики людей /
// колонки-группы верхнего канбана (по сортировке) / фантомные колонки-пикеры.
type OverData = {
  type?: string;
  bucket?: string;
  member?: SharedMember;
  // type='group' (план inbox-grouped-dnd): смысл дропа по активной сортировке блока.
  grouping?: string;
  projectId?: string;
  priority?: string; // '1'..'4' | 'none'
  // type='phantom': какой пикер открыть ('project' | 'priority' | 'created' — забрать себе).
  kind?: string;
  // type='column' (колонка доски) — цель дропа пилюли блока: снять делегацию + статус.
  status?: TaskStatus;
  // type='task' (карточка доски как over-цель) — трактуем как её колонку.
  task?: Task;
};

// === Единый DnD «Входящих» (#5) ===
// ОДИН <DndContext> на страницу: доска (нижний канбан статусов) и блок делегирования
// (время-канбаны + кубики людей) регистрируют в нём свои draggable/droppable, а этот
// компонент диспетчеризует onDrag* по происхождению active и типу over:
//   • доска-карточка → column/task  — родная логика доски (move/реордер);
//   • доска-карточка → bucket      — дедлайн задаче (none/today; future — попап даты);
//   • доска-карточка → user        — делегировать (свой кубик — забрать себе/withdraw);
//   • доска-карточка → group       — по сортировке блока: project → перенос в проект +
//     самоделегирование; priority → смена приоритета (план inbox-grouped-dnd);
//   • доска-карточка → phantom     — пикеры «Другой проект…» / «Другой приоритет…» /
//     «Забрать себе» (created). Любой дроп доски-карточки в верхний канбан дополнительно
//     самоделегирует недоделегированную задачу («мне делегировалось»);
//   • блок-карточка  → bucket/user — родная логика блока (срок/переназначение);
//   • блок-карточка  → column/task доски — снять делегацию (withdraw/relinquish) и для
//     задач своего инбокса поставить статус колонки.
// Оверлей тоже один, вид зависит от происхождения: карточка доски с tilt (drop-анимация
// как у KanbanBoard) либо пилюля-«комок» блока (без drop-анимации, липнет к курсору).
export function InboxUnifiedDnd({ registry, projectId, children }: Props): React.ReactElement {
  const { taskRepository, taskDelegationRepository } = useContainer();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  // Мои проекты — цели переноса задач доски (пикер «Другой проект…» и резолв имени в тосте).
  const { data: allProjects } = useProjectsContext();
  const myProjects = useMemo(
    () => (allProjects ?? []).filter((p) => !p.isInbox && p.status !== 'archived'),
    [allProjects],
  );

  // Идентичны сенсорам обоих компонентов в own-режиме: мышь — порог 8px (клик не драг),
  // тач — long-press 220мс (скролл пальцем не хватает карточку).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const [active, setActive] = useState<ActiveDrag | null>(null);
  // Дроп доски-карточки в «Будущее» → попап выбора срока (тот же, что у блока).
  const [futureDrop, setFutureDrop] = useState<Task | null>(null);
  // Дроп доски-карточки на фантомные колонки → пикеры «Другой проект…» / «Другой приоритет…».
  const [projectPick, setProjectPick] = useState<Task | null>(null);
  const [priorityPick, setPriorityPick] = useState<Task | null>(null);

  // После смены ответственного обновляем обе зоны: бейдж на карточке доски + списки блока.
  const afterDelegationChange = async (): Promise<void> => {
    await Promise.all([registry.current.board?.refetch(), registry.current.block?.refresh()]);
  };

  // «Поручить себе» задачу ДОСКИ: любой дроп в верхний канбан означает «мне делегировалось»
  // (просьба юзера) — недоделегированная задача получает accepted-самоделегирование и
  // появляется в блоке. Уже делегированную (мне или другому) не трогаем. true = создали.
  const ensureSelfDelegated = async (task: Task): Promise<boolean> => {
    if (!user || task.delegation) return false;
    try {
      await taskRepository.delegate(projectId, task.id, user.id);
      return true;
    } catch (e) {
      toast.error(`Не удалось поручить вам: ${(e as Error).message}`);
      return false;
    }
  };

  // Обновление зон после операции над задачей доски: создали самоделегирование → обе зоны;
  // задача уже была делегирована → пере-бакетить блок; иначе ничего (доска обновилась сама).
  const refreshAfterBoardOp = async (task: Task, selfDelegated: boolean): Promise<void> => {
    if (selfDelegated) await afterDelegationChange();
    else if (task.delegation) await registry.current.block?.refresh();
  };

  // Дроп доски-карточки в верхний канбан БЕЗ смены свойства (свой же бакет/приоритет или
  // фантом «Забрать себе» в сортировке по дате создания): только самоделегирование.
  // quiet — не тостить, когда дроп был про свойство и оно не изменилось.
  const claimBoardTask = async (task: Task, quiet: boolean): Promise<void> => {
    if (!user) return;
    if (task.delegation) {
      if (quiet) return;
      if (task.delegation.delegateUserId === user.id) toast.info('Задача уже поручена вам');
      else toast.error('Задача поручена другому — заберите её дропом на свой кубик');
      return;
    }
    const created = await ensureSelfDelegated(task);
    if (created) {
      if (!quiet) toast.success('Задача поручена вам');
      await afterDelegationChange();
    }
  };

  // Дедлайн задачи ДОСКИ через её собственный useTasks.update (локальный стейт доски
  // обновится сам) + самоделегирование (дроп в верхний канбан = «мне делегировалось»).
  const applyBoardDeadline = async (task: Task, deadline: string | null): Promise<void> => {
    const board = registry.current.board;
    if (!board) return;
    try {
      await board.updateTask(task.id, { deadline });
      toast.success(deadline ? 'Срок изменён' : 'Срок снят');
    } catch (e) {
      toast.error(`Не удалось изменить срок: ${(e as Error).message}`);
      return;
    }
    await refreshAfterBoardOp(task, await ensureSelfDelegated(task));
  };

  const dropBoardTaskOnBucket = (task: Task, bucket: string): void => {
    // Дроп в свой же бакет — свойство не меняем, но самоделегирование всё равно делаем
    // (смысл дропа в верхний канбан — «поручить мне»).
    const today = ymd(startOfDay(new Date()));
    const cur = task.deadline == null ? 'none' : task.deadline <= today ? 'today' : 'future';
    if (cur === bucket) {
      void claimBoardTask(task, true);
      return;
    }
    if (bucket === 'none') void applyBoardDeadline(task, null);
    else if (bucket === 'today') void applyBoardDeadline(task, today);
    else if (bucket === 'future') setFutureDrop(task);
  };

  // Приоритет задачи ДОСКИ (дроп на колонку приоритета / выбор в пикере) + самоделегирование.
  const applyBoardPriority = async (task: Task, priority: TaskPriority | null): Promise<void> => {
    const board = registry.current.board;
    if (!board) return;
    if ((task.priority ?? null) === priority) {
      void claimBoardTask(task, true);
      return;
    }
    try {
      await board.updateTask(task.id, { priority });
      toast.success(priority === null ? 'Приоритет снят' : `Приоритет: ${PRIORITY_META[priority].label}`);
    } catch (e) {
      toast.error(`Не удалось изменить приоритет: ${(e as Error).message}`);
      return;
    }
    await refreshAfterBoardOp(task, await ensureSelfDelegated(task));
  };

  // Дроп пилюли БЛОКА на колонку нижней доски — задача переезжает вниз (правило «ровно
  // один канбан»):
  // • задача СВОЕГО инбокса → снять делегацию (моя исходящая → withdraw; поручена мне →
  //   relinquish) + статус колонки;
  // • задача ИМЕНОВАННОГО проекта → перенос в мой инбокс (assignToProject; сервер сам
  //   архивирует делегацию, себя не уведомляет) + статус колонки;
  // • задача ЧУЖОГО инбокса → только relinquish (личное пространство делегатора — вытащить
  //   из него задачу нельзя, у владельца она остаётся).
  const dropBlockItemOnBoardColumn = async (
    item: AssignedTask,
    status: TaskStatus,
  ): Promise<void> => {
    if (!user) return;
    const d = item.delegation;
    if (!item.isInbox) {
      try {
        await taskRepository.assignToProject(item.projectId, item.id, projectId);
      } catch (e) {
        toast.error(`Не удалось перенести во «Входящие»: ${(e as Error).message}`);
        return;
      }
      try {
        await registry.current.board?.moveTask(item.id, status);
      } catch (e) {
        toast.error(`Перенесено, но поставить колонку не удалось: ${(e as Error).message}`);
      }
      toast.success(`Перенесено во «Входящие» из «${item.projectName}»`);
      await afterDelegationChange();
      return;
    }
    try {
      if (d.creatorUserId === user.id) await taskDelegationRepository.withdraw(d.id);
      else if (d.delegateUserId === user.id) await taskDelegationRepository.relinquish(d.id);
      else {
        toast.error('Снять можно только делегацию, где вы автор или исполнитель');
        return;
      }
    } catch (e) {
      toast.error(`Не удалось снять делегацию: ${(e as Error).message}`);
      return;
    }
    if (item.projectId === projectId) {
      try {
        await registry.current.board?.moveTask(item.id, status);
      } catch (e) {
        toast.error(`Делегация снята, но перенести в колонку не удалось: ${(e as Error).message}`);
      }
    }
    toast.success('Делегация снята');
    await afterDelegationChange();
  };

  // Перенос задачи ДОСКИ в проект (дроп на колонку проекта / выбор в пикере) + назначение
  // себя ответственным: верхний канбан показывает только делегации, без самоделегирования
  // перенесённая задача «исчезла бы» со страницы. Старая делегация архивируется сервером
  // (assignToProject), затем создаём accepted-самоделегирование (сервер разрешает, см.
  // DelegateExistingTask). Фейл второго шага перенос НЕ откатывает — отдельный тост.
  const moveBoardTaskToProject = async (task: Task, targetProjectId: string): Promise<void> => {
    if (!user) return;
    const target = myProjects.find((p) => p.id === targetProjectId);
    try {
      await taskRepository.assignToProject(projectId, task.id, targetProjectId);
    } catch (e) {
      toast.error(`Не удалось перенести: ${(e as Error).message}`);
      return;
    }
    try {
      await taskRepository.delegate(targetProjectId, task.id, user.id);
    } catch (e) {
      toast.error(`Перенесено, но не удалось назначить вас ответственным: ${(e as Error).message}`);
    }
    toast.success(`Перенесено в «${target?.name ?? 'проект'}»`, {
      action: { label: 'Открыть', onClick: () => navigate(`/projects/${targetProjectId}`) },
    });
    await afterDelegationChange();
  };

  // Делегирование задачи ДОСКИ дропом на кубик человека. Логика — зеркало селектора
  // «Ответственный» (DelegateTaskButton): есть активная делегация → reassign, нет → delegate;
  // свой кубик → withdraw («забрать себе»); недоделегированная задача на своём кубике —
  // честный no-op (она и так ваша, самоделегирование тут ничего не добавит).
  const dropBoardTaskOnUser = async (task: Task, member: SharedMember): Promise<void> => {
    if (!user) return;
    const d = task.delegation ?? null;
    if (member.id === user.id) {
      if (!d) {
        toast.info('Задача и так ваша');
        return;
      }
      if (d.delegateUserId === user.id) {
        toast.info('Задача уже назначена вам');
        return;
      }
      if (d.creatorUserId !== user.id) {
        toast.error('Забрать себе можно только задачу, которую делегировали вы');
        return;
      }
      try {
        await taskDelegationRepository.withdraw(d.id);
        toast.success('Задача возвращена вам');
        await afterDelegationChange();
      } catch (e) {
        toast.error(`Не удалось забрать: ${(e as Error).message}`);
      }
      return;
    }
    if (d && d.delegateUserId === member.id) return; // уже на нём
    try {
      if (d) await taskRepository.reassign(projectId, task.id, member.id);
      else await taskRepository.delegate(projectId, task.id, member.id);
      toast.success(`Ответственный — ${member.displayName}`);
      await afterDelegationChange();
    } catch (e) {
      // Кубики = shared-members caller'а, а inbox-делегирование валидируется по ним же —
      // любая ошибка здесь всё равно остаётся честным тостом.
      toast.error(`Не удалось делегировать: ${(e as Error).message}`);
    }
  };

  const handleDragStart = (e: DragStartEvent): void => {
    // Висящий drop-таймер прошлого перетаскивания — гасим, иначе он обнулит новый active.
    const info = detectActive(e.active);
    setActive(info);
    if (info?.origin === 'board') {
      registry.current.board?.onDragStart(e);
    }
    // Блоку — всегда: он подсвечивает кубики-цели и для драгов с доски.
    registry.current.block?.onDragStart(e);
  };

  const handleDragOver = (e: DragOverEvent): void => {
    // Drop-индикатор доски — только для её собственных карточек. Для пилюли блока над
    // колонкой доски индикатор врал бы: такой дроп не операция (диспетчер его игнорирует).
    if (detectActive(e.active)?.origin === 'board') registry.current.board?.onDragOver(e);
  };

  const handleDragEnd = (e: DragEndEvent): void => {
    const info = detectActive(e.active);
    // Блоку — всегда: гасит подсветку кубиков; для его карточек — родные bucket/user-операции.
    registry.current.block?.onDragEnd(e);
    if (info?.origin === 'board') {
      // Родной settle + move доски (для чужих over-целей move — no-op). Ошибки тостит сама.
      void registry.current.board?.onDragEnd(e);
      // Пилюля без drop-анимации — прячем сразу (как у блока).
      setActive(null);
      const overData = e.over?.data.current as OverData | undefined;
      if (overData?.type === 'bucket' && overData.bucket) {
        dropBoardTaskOnBucket(info.task, overData.bucket);
      } else if (overData?.type === 'user' && overData.member) {
        void dropBoardTaskOnUser(info.task, overData.member);
      } else if (overData?.type === 'group' && overData.grouping === 'project' && overData.projectId) {
        void moveBoardTaskToProject(info.task, overData.projectId);
      } else if (overData?.type === 'group' && overData.grouping === 'priority' && overData.priority) {
        void applyBoardPriority(
          info.task,
          overData.priority === 'none' ? null : (Number(overData.priority) as TaskPriority),
        );
      } else if (overData?.type === 'phantom' && overData.kind === 'project') {
        setProjectPick(info.task);
      } else if (overData?.type === 'phantom' && overData.kind === 'priority') {
        setPriorityPick(info.task);
      } else if (overData?.type === 'phantom' && overData.kind === 'created') {
        // Сортировка «по дате создания»: свойство не меняем (дату не изменить) —
        // фантом «Забрать себе» просто поручает задачу мне, она встанет по своей дате.
        void claimBoardTask(info.task, false);
      }
    } else if (info?.origin === 'block') {
      setActive(null); // пилюля блока без drop-анимации — прячем сразу
      // Дроп пилюли на нижнюю доску: колонка напрямую ИЛИ карточка доски (= её колонка,
      // in_progress/awaiting_clarification визуально живут в TODO).
      const overData = e.over?.data.current as OverData | undefined;
      if (overData?.type === 'column' && overData.status) {
        void dropBlockItemOnBoardColumn(info.item, overData.status);
      } else if (overData?.type === 'task' && overData.task) {
        const s = overData.task.status;
        const visible: TaskStatus =
          s === 'in_progress' || s === 'awaiting_clarification' ? 'todo' : s;
        void dropBlockItemOnBoardColumn(info.item, visible);
      }
    } else {
      setActive(null);
    }
  };

  const handleDragCancel = (): void => {
    registry.current.block?.onDragCancel();
    registry.current.board?.onDragCancel();
    setActive(null);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={dndCollision}
        measuring={MEASURING_CONFIG}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        {/* Один оверлей на страницу; вид и drop-анимация зависят от происхождения active. */}
        {/* И доска, и блок делегирования тащат ОДИНАКОВО — полупрозрачной однострочной
            пилюлей (запрос: drag из нижних канбанов тоже прозрачный и в строку). */}
        <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
          {active?.origin === 'board' ? (
            <TaskDragPill title={plainTaskTitle(active.task.description ?? '')} />
          ) : active?.origin === 'block' ? (
            <AssignedDragPill item={active.item} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Дроп доски-карточки в «Будущее» → выбор срока (неделя / конец месяца / день). */}
      <FutureDeadlineDialog
        open={futureDrop !== null}
        onClose={() => setFutureDrop(null)}
        onPick={(deadline) => {
          const t = futureDrop;
          setFutureDrop(null);
          if (t) void applyBoardDeadline(t, deadline);
        }}
      />

      {/* Дроп на фантом «Другой проект…» → выбор проекта переноса. */}
      <ProjectPickDialog
        open={projectPick !== null}
        projects={myProjects}
        onClose={() => setProjectPick(null)}
        onPick={(target) => {
          const t = projectPick;
          setProjectPick(null);
          if (t) void moveBoardTaskToProject(t, target);
        }}
      />

      {/* Дроп на фантом «Другой приоритет…» → выбор приоритета (все 5 вариантов). */}
      <PriorityPickDialog
        open={priorityPick !== null}
        onClose={() => setPriorityPick(null)}
        onPick={(priority) => {
          const t = priorityPick;
          setPriorityPick(null);
          if (t) void applyBoardPriority(t, priority);
        }}
      />
    </>
  );
}

// Пикер проекта для переноса задачи доски (дроп на фантомную колонку «Другой проект…»).
// Все мои проекты (кроме инбокса/архивных) — иконка + имя, скролл при длинном списке.
function ProjectPickDialog({
  open,
  projects,
  onClose,
  onPick,
}: {
  open: boolean;
  projects: readonly Project[];
  onClose: () => void;
  onPick: (projectId: string) => void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Перенести в проект</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {projects.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">Проектов пока нет.</p>
          )}
          {projects.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              className="justify-start gap-2"
              onClick={() => onPick(p.id)}
            >
              {/* Фикс-квадрат под иконку: эмодзи-ветка ProjectIconView рендерит span с
                  size-full и без контейнера растягивается на всю кнопку (текст уезжал
                  вправо с огромным пробелом). */}
              <span className="grid size-4 shrink-0 place-items-center overflow-hidden">
                {p.icon ? (
                  <ProjectIconView icon={p.icon} pixelSize={16} className="text-sm" />
                ) : (
                  <FolderKanban className="size-4 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 truncate">{p.name}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Пикер приоритета для задачи доски (дроп на фантомную колонку «Другой приоритет…»).
// Все 5 вариантов — как в редакторе задачи (подтверждено юзером).
function PriorityPickDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (priority: TaskPriority | null) => void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Приоритет задачи</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {TASK_PRIORITIES.map((p) => (
            <Button
              key={p}
              variant="outline"
              className="justify-start gap-2"
              onClick={() => onPick(p)}
            >
              <span className={cn('size-2.5 rounded-full', PRIORITY_META[p].dotColor)} aria-hidden />
              {PRIORITY_META[p].label}
            </Button>
          ))}
          <Button
            variant="outline"
            className="justify-start gap-2 text-muted-foreground"
            onClick={() => onPick(null)}
          >
            <span className="size-2.5 rounded-full bg-muted-foreground/30" aria-hidden />
            Без приоритета
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
