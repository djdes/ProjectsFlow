import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { usePageRefresh } from '@/presentation/components/experience/usePageRefresh';
import { useContainer } from '@/infrastructure/di/container';
import type {
  RalphMode,
  RunMode,
  Task,
  TaskPriority,
  TaskStatus,
} from '@/domain/task/Task';
import type { MoveTaskInput } from '@/application/task/TaskRepository';
import { useRealtimeTaskRefresh } from './useRealtimeTaskRefresh';
import { useReadRefreshed } from './useReadRefreshed';
import { useCurrentUser } from './useCurrentUser';
import { trackProjectAction } from '@/lib/productAnalytics';
import { getDefaultTaskDeadline } from '@/domain/task/defaultTaskDeadline';

type State = {
  // Shared with the repository while the answer is unchanged (listForScreen): never mutated.
  tasks: readonly Task[];
  loading: boolean;
  error: string | null;
};

export type UseTasks = State & {
  refetch: () => Promise<void>;
  create: (input: {
    description: string;
    icon?: string | null;
    cover?: string | null;
    coverPosition?: number;
    status: TaskStatus;
    afterTaskId?: string | null;
    ralphMode?: RalphMode;
    runMode?: RunMode;
    assigneeUserId?: string;
    deadline?: string | null;
    startDate?: string | null;
    parentTaskId?: string | null;
    priority?: TaskPriority | null;
  }) => Promise<Task>;
  update: (
    taskId: string,
    input: {
      description?: string;
      icon?: string | null;
      cover?: string | null;
      coverPosition?: number;
      ralphMode?: RalphMode;
      runMode?: RunMode;
      deadline?: string | null;
      startDate?: string | null;
      priority?: TaskPriority | null;
    },
  ) => Promise<Task>;
  // Optimistic placement rolls back even when the network is unavailable.
  move: (
    taskId: string,
    input: MoveTaskInput,
    onSuccess?: (updated: Task) => void,
  ) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
};

export function useTasks(projectId: string): UseTasks {
  const { taskRepository } = useContainer();
  const { user } = useCurrentUser();
  // Known from an earlier visit: the board renders it at once (no skeleton) and the mount read
  // below refreshes it.
  const [state, setState] = useState<State & { projectId: string }>(() => {
    const known = taskRepository.peekList(projectId);
    return { projectId, tasks: known ?? [], loading: known === null, error: null };
  });
  const scope = useRef(projectId);
  const latestState = useRef(state);
  useLayoutEffect(() => {
    latestState.current = state;
  }, [state]);
  const requests = useRef(0);
  const latestInFlight = useRef(0);
  const mutations = useRef(new Map<string, number>());
  const moveVersions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    scope.current = projectId;
    return () => {
      scope.current = '';
      requests.current += 1;
      latestInFlight.current = 0;
    };
  }, [projectId]);
  const apply = (change: (current: State) => State): void => {
    if (scope.current !== projectId) return;
    setState((current) =>
      current.projectId === projectId
        ? { ...change(current), projectId }
        : current,
    );
  };
  const beginMutation = (): void => {
    if (scope.current === projectId) requests.current += 1;
    mutations.current.set(
      projectId,
      (mutations.current.get(projectId) ?? 0) + 1,
    );
  };
  const endMutation = (): void => {
    if (scope.current === projectId) requests.current += 1;
    const remaining = (mutations.current.get(projectId) ?? 1) - 1;
    if (remaining) mutations.current.set(projectId, remaining);
    else mutations.current.delete(projectId);
    // Returning to this board while its earlier mutation is pending must not leave
    // its first list response discarded and the skeleton stuck indefinitely.
    if (
      !remaining &&
      scope.current === projectId &&
      (latestState.current.loading ||
        latestState.current.projectId !== projectId)
    )
      void load();
  };

  // Задачу адресуем ЕЁ projectId, а не projectId доски: они совпадают почти всегда, но в
  // момент передачи владения (личная задача уезжает в inbox нового ответственного, см.
  // ChangeTaskAssignee) локальный снимок может ещё держать старую доску — тогда запрос
  // по projectId доски вернул бы 404. Снимок в ref: колбэки async и видели бы stale state.
  const tasksRef = useRef<readonly Task[]>([]);
  useEffect(() => {
    tasksRef.current = state.projectId === projectId ? state.tasks : [];
  }, [state.tasks, state.projectId, projectId]);
  const projectIdOf = (taskId: string): string =>
    tasksRef.current.find((t) => t.id === taskId)?.projectId ?? projectId;

  // refetch() НЕ сбрасывает loading=true и НЕ обнуляет tasks. Это критично для
  // SSE-обновлений: каждое SSE-событие вызывает refetch, и если бы тут стояло
  // `loading: true` — KanbanBoard переключался в skeleton-режим на ~100-300мс,
  // что юзеры видят как «контент мигает». Теперь данные обновляются in-place.
  // Skeleton показывается только при первом mount/смене projectId (см. useEffect).
  // На ошибке tasks НЕ обнуляем — пусть юзер видит последний снимок + error.
  // latest (default) — after a change, an event or a gesture: wait for the current list.
  // Otherwise what is known comes at once and a newer list is announced (useReadRefreshed).
  const load = useCallback(
    async (propagateError = false, latest = true): Promise<void> => {
      // Never let a background SWR re-read (useReadRefreshed) cancel an in-flight latest=true
      // network refetch or run while a local mutation is active on this board.
      if (!latest && (latestInFlight.current > 0 || mutations.current.has(projectId))) return;
      const request = ++requests.current;
      if (latest) latestInFlight.current += 1;
      try {
        const tasks = await taskRepository.listForScreen(projectId, { latest });
        if (
          scope.current === projectId &&
          request === requests.current &&
          !mutations.current.has(projectId)
        )
          setState({ projectId, tasks, loading: false, error: null });
      } catch (e) {
        if (
          scope.current === projectId &&
          request === requests.current &&
          !mutations.current.has(projectId)
        )
          setState((s) => ({
            ...s,
            loading: false,
            error: (e as Error).message ?? 'Не удалось загрузить',
          }));
        if (propagateError) throw e;
      } finally {
        if (latest && latestInFlight.current > 0) latestInFlight.current -= 1;
      }
    },
    [taskRepository, projectId],
  );
  const refetch = useCallback(() => load(), [load]);
  usePageRefresh(() => load(true), Boolean(projectId));

  useEffect(() => {
    // Смена projectId — показываем то, что о новой доске уже известно, а skeleton только если
    // ничего (первый mount это уже сделал в useState). Потом читаем: известное — сразу, свежее
    // — следом (useReadRefreshed ниже). SSE-refetch'и идут мимо useEffect (refetch вызывается
    // напрямую из useRealtimeTaskRefresh), поэтому skeleton не дёргается на каждый event.
    setState((current) => {
      if (current.projectId === projectId) return current;
      const known = taskRepository.peekList(projectId);
      return { projectId, tasks: known ?? [], loading: known === null, error: null };
    });
    void load(false, false);
  }, [load, projectId, taskRepository]);
  useReadRefreshed(() => void load(false, false), ['tasks']);

  // Live-обновление: рефетч при SSE-событии об изменении задач в этом проекте + при
  // возврате фокуса. void — refetch возвращает Promise, нам результат не нужен.
  useRealtimeTaskRefresh(projectId, () => void refetch());

  // Событие «в проекте что-то поменялось» → мгновенно обновить «Изменено …» и ленту активности.
  const notifyChanged = (): void => {
    try {
      window.dispatchEvent(
        new CustomEvent('pf:project-activity-changed', {
          detail: { projectId },
        }),
      );
    } catch {
      /* среда без window — no-op */
    }
  };

  const create: UseTasks['create'] = async (input) => {
    const startedAt = performance.now();
    const assigneeUserId = input.assigneeUserId ?? user?.id;
    if (!assigneeUserId)
      throw new Error('Не удалось определить ответственного');
    beginMutation();
    try {
      const task = await taskRepository.create(projectId, {
        ...input,
        assigneeUserId,
        deadline: input.deadline === undefined ? getDefaultTaskDeadline() : input.deadline,
      });
      apply((s) => ({
        ...s,
        tasks: [...s.tasks.filter((t) => t.id !== task.id), task],
      }));
      notifyChanged();
      window.dispatchEvent(
        new CustomEvent('pf:task-created', {
          detail: { projectId, taskId: task.id },
        }),
      );
      trackProjectAction({
        projectId,
        action: 'create_task',
        result: 'success',
        startedAt,
      });
      return task;
    } catch (error) {
      trackProjectAction({
        projectId,
        action: 'create_task',
        result: 'failure',
        startedAt,
      });
      throw error;
    } finally {
      endMutation();
    }
  };

  const update: UseTasks['update'] = async (taskId, input) => {
    beginMutation();
    try {
      const updated = await taskRepository.update(
        projectIdOf(taskId),
        taskId,
        input,
      );
      apply((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
      notifyChanged();
      return updated;
    } finally {
      endMutation();
    }
  };

  const move: UseTasks['move'] = async (taskId, input, onSuccess) => {
    const original = tasksRef.current.find((t) => t.id === taskId);
    const version = (moveVersions.current.get(taskId) ?? 0) + 1;
    moveVersions.current.set(taskId, version);
    beginMutation();
    // Оптимистично: пересчитываем status и position локально ДО сетевого вызова.
    // Position берём как midpoint между beforeTaskId/afterTaskId если они есть, иначе ±1024.
    apply((s) => {
      const task = s.tasks.find((t) => t.id === taskId);
      if (!task) return s;
      const beforePos = input.beforeTaskId
        ? (s.tasks.find((t) => t.id === input.beforeTaskId)?.position ?? null)
        : null;
      const afterPos = input.afterTaskId
        ? (s.tasks.find((t) => t.id === input.afterTaskId)?.position ?? null)
        : null;
      let newPos: number;
      if (beforePos !== null && afterPos !== null)
        newPos = (beforePos + afterPos) / 2;
      else if (beforePos !== null) newPos = beforePos + 1024;
      else if (afterPos !== null) newPos = afterPos - 1024;
      else {
        // Колонка пустая — first item, любое значение.
        newPos = 1024;
      }
      return {
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: input.targetStatus, position: newPos }
            : t,
        ),
      };
    });
    try {
      const updated = await taskRepository.move(
        projectIdOf(taskId),
        taskId,
        input,
      );
      if (moveVersions.current.get(taskId) === version)
        apply((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
        }));
      notifyChanged();
      if (moveVersions.current.get(taskId) === version) onSuccess?.(updated);
    } catch (e) {
      // A failed refresh (for example offline) must still roll the card back.
      if (original && moveVersions.current.get(taskId) === version)
        apply((s) => ({
          ...s,
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, status: original.status, position: original.position }
              : t,
          ),
        }));
      throw e;
    } finally {
      endMutation();
    }
  };

  const remove: UseTasks['remove'] = async (taskId) => {
    beginMutation();
    try {
      await taskRepository.delete(projectIdOf(taskId), taskId);
      apply((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }));
      notifyChanged();
    } finally {
      endMutation();
    }
  };

  const visible =
    state.projectId === projectId
      ? state
      : { tasks: [], loading: true, error: null };
  return { ...visible, refetch, create, update, move, remove };
}
