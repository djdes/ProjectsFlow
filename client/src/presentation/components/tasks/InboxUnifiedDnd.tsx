import { useMemo, useRef, useState } from 'react';
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
import { motion } from 'motion/react';
import { FolderKanban } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority } from '@/domain/task/Task';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Project } from '@/domain/project/Project';
import type { SharedMember } from '@/application/project/ProjectRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { KanbanCard } from './KanbanCard';
import {
  DROP_ANIMATION,
  DROP_DURATION_MS,
  DROP_EASING_BEZIER,
  MEASURING_CONFIG,
} from './KanbanBoard';
import {
  AssignedDragPill,
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
  // type='phantom': какой пикер открыть.
  kind?: string;
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
//   • доска-карточка → phantom     — пикеры «Другой проект…» / «Другой приоритет…»;
//   • блок-карточка  → bucket/user — родная логика блока (срок/переназначение).
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
  // Фазы оверлея доски-карточки — зеркало KanbanBoard: 'lifted' (наклон) → 'settled'
  // (лерп к identity синхронно с position-lerp'ом DragOverlay). Держим active до конца
  // drop-анимации, чтобы motion успел распрямить наклон.
  const [previewPhase, setPreviewPhase] = useState<'lifted' | 'settled'>('settled');
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Дроп доски-карточки в «Будущее» → попап выбора срока (тот же, что у блока).
  const [futureDrop, setFutureDrop] = useState<Task | null>(null);
  // Дроп доски-карточки на фантомные колонки → пикеры «Другой проект…» / «Другой приоритет…».
  const [projectPick, setProjectPick] = useState<Task | null>(null);
  const [priorityPick, setPriorityPick] = useState<Task | null>(null);

  // Дедлайн задачи ДОСКИ через её собственный useTasks.update (локальный стейт доски
  // обновится сам). Делегированная задача живёт и в верхнем блоке — пере-бакетим её там.
  const applyBoardDeadline = async (task: Task, deadline: string | null): Promise<void> => {
    const board = registry.current.board;
    if (!board) return;
    try {
      await board.updateTask(task.id, { deadline });
      toast.success(deadline ? 'Срок изменён' : 'Срок снят');
      if (task.delegation) await registry.current.block?.refresh();
    } catch (e) {
      toast.error(`Не удалось изменить срок: ${(e as Error).message}`);
    }
  };

  const dropBoardTaskOnBucket = (task: Task, bucket: string): void => {
    // Дроп в свой же бакет — no-op (зеркало блока: не дёргаем сервер и попап).
    const today = ymd(startOfDay(new Date()));
    const cur = task.deadline == null ? 'none' : task.deadline <= today ? 'today' : 'future';
    if (cur === bucket) return;
    if (bucket === 'none') void applyBoardDeadline(task, null);
    else if (bucket === 'today') void applyBoardDeadline(task, today);
    else if (bucket === 'future') setFutureDrop(task);
  };

  // После смены ответственного обновляем обе зоны: бейдж на карточке доски + списки блока.
  const afterDelegationChange = async (): Promise<void> => {
    await Promise.all([registry.current.board?.refetch(), registry.current.block?.refresh()]);
  };

  // Приоритет задачи ДОСКИ (дроп на колонку приоритета / выбор в пикере). Карточка остаётся
  // на доске — меняется только бейдж; в верхнем канбане пере-бакетится, если делегирована.
  const applyBoardPriority = async (task: Task, priority: TaskPriority | null): Promise<void> => {
    const board = registry.current.board;
    if (!board || (task.priority ?? null) === priority) return;
    try {
      await board.updateTask(task.id, { priority });
      toast.success(priority === null ? 'Приоритет снят' : `Приоритет: ${PRIORITY_META[priority].label}`);
      if (task.delegation) await registry.current.block?.refresh();
    } catch (e) {
      toast.error(`Не удалось изменить приоритет: ${(e as Error).message}`);
    }
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
      // инвайт-флоу (delegate_not_*) здесь недостижим, любая ошибка — честный тост.
      toast.error(`Не удалось делегировать: ${(e as Error).message}`);
    }
  };

  const handleDragStart = (e: DragStartEvent): void => {
    // Висящий drop-таймер прошлого перетаскивания — гасим, иначе он обнулит новый active.
    if (dropTimerRef.current) {
      clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    const info = detectActive(e.active);
    setActive(info);
    if (info?.origin === 'board') {
      setPreviewPhase('lifted');
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
      // Зеркало settle для нашего оверлея: наклон → identity, карточку держим до конца анимации.
      setPreviewPhase('settled');
      dropTimerRef.current = setTimeout(() => {
        setActive(null);
        dropTimerRef.current = null;
      }, DROP_DURATION_MS);
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
      }
    } else {
      setActive(null); // пилюля блока без drop-анимации — прячем сразу
    }
  };

  const handleDragCancel = (): void => {
    registry.current.block?.onDragCancel();
    registry.current.board?.onDragCancel();
    setActive(null);
    setPreviewPhase('settled');
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
        <DragOverlay
          dropAnimation={active?.origin === 'board' ? DROP_ANIMATION : null}
          modifiers={active?.origin === 'block' ? [snapToCursor] : undefined}
        >
          {active?.origin === 'board' ? (
            <motion.div
              initial={false}
              animate={
                previewPhase === 'lifted' ? { rotate: 2, scale: 1.04 } : { rotate: 0, scale: 1 }
              }
              transition={{ duration: DROP_DURATION_MS / 1000, ease: DROP_EASING_BEZIER }}
              style={{ transformOrigin: 'center' }}
            >
              {/* showShortId=false: у inbox-задач нет git-репо (как в own-оверлее инбокс-доски). */}
              <KanbanCard
                task={active.task}
                onEdit={() => undefined}
                onDelete={() => undefined}
                preview
                showShortId={false}
              />
            </motion.div>
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
              {p.icon ? (
                <ProjectIconView icon={p.icon} pixelSize={16} className="text-base" />
              ) : (
                <FolderKanban className="size-4 text-muted-foreground" />
              )}
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
