import { useCallback, useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { MoveTaskInput } from '@/application/task/TaskRepository';
import { useRealtimeTaskRefresh } from './useRealtimeTaskRefresh';

type State = {
  tasks: Task[];
  loading: boolean;
  error: string | null;
};

export type UseTasks = State & {
  refetch: () => Promise<void>;
  create: (input: {
    description: string;
    status: TaskStatus;
    ralphMode?: RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }) => Promise<Task>;
  update: (
    taskId: string,
    input: {
      description?: string;
      ralphMode?: RalphMode;
      deadline?: string | null;
      priority?: TaskPriority | null;
    },
  ) => Promise<Task>;
  // Оптимистично переставляет локально + летит на сервер. На фейле ревёртится из refetch'а.
  move: (taskId: string, input: MoveTaskInput) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
};

export function useTasks(projectId: string): UseTasks {
  const { taskRepository } = useContainer();
  const [state, setState] = useState<State>({ tasks: [], loading: true, error: null });

  // refetch() НЕ сбрасывает loading=true и НЕ обнуляет tasks. Это критично для
  // SSE-обновлений: каждое SSE-событие вызывает refetch, и если бы тут стояло
  // `loading: true` — KanbanBoard переключался в skeleton-режим на ~100-300мс,
  // что юзеры видят как «контент мигает». Теперь данные обновляются in-place.
  // Skeleton показывается только при первом mount/смене projectId (см. useEffect).
  // На ошибке tasks НЕ обнуляем — пусть юзер видит последний снимок + error.
  const refetch = useCallback(async (): Promise<void> => {
    try {
      const tasks = await taskRepository.list(projectId);
      setState({ tasks, loading: false, error: null });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: (e as Error).message ?? 'Не удалось загрузить',
      }));
    }
  }, [taskRepository, projectId]);

  useEffect(() => {
    // Смена projectId (или первый mount) — сбрасываем в skeleton-state, потом
    // фетчим. SSE-refetch'и идут мимо useEffect (refetch вызывается напрямую
    // из useRealtimeTaskRefresh), поэтому skeleton не дёргается на каждый event.
    setState({ tasks: [], loading: true, error: null });
    void refetch();
  }, [refetch]);

  // Live-обновление: рефетч при SSE-событии об изменении задач в этом проекте + при
  // возврате фокуса. void — refetch возвращает Promise, нам результат не нужен.
  useRealtimeTaskRefresh(projectId, () => void refetch());

  // Событие «в проекте что-то поменялось» → мгновенно обновить «Изменено …» и ленту активности.
  const notifyChanged = (): void => {
    try {
      window.dispatchEvent(new CustomEvent('pf:project-activity-changed', { detail: { projectId } }));
    } catch {
      /* среда без window — no-op */
    }
  };

  const create: UseTasks['create'] = async (input) => {
    const task = await taskRepository.create(projectId, input);
    setState((s) => ({ ...s, tasks: [...s.tasks, task] }));
    notifyChanged();
    return task;
  };

  const update: UseTasks['update'] = async (taskId, input) => {
    const updated = await taskRepository.update(projectId, taskId, input);
    setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)) }));
    notifyChanged();
    return updated;
  };

  const move: UseTasks['move'] = async (taskId, input) => {
    // Оптимистично: пересчитываем status и position локально ДО сетевого вызова.
    // Position берём как midpoint между beforeTaskId/afterTaskId если они есть, иначе ±1024.
    setState((s) => {
      const task = s.tasks.find((t) => t.id === taskId);
      if (!task) return s;
      const beforePos = input.beforeTaskId
        ? s.tasks.find((t) => t.id === input.beforeTaskId)?.position ?? null
        : null;
      const afterPos = input.afterTaskId
        ? s.tasks.find((t) => t.id === input.afterTaskId)?.position ?? null
        : null;
      let newPos: number;
      if (beforePos !== null && afterPos !== null) newPos = (beforePos + afterPos) / 2;
      else if (beforePos !== null) newPos = beforePos + 1024;
      else if (afterPos !== null) newPos = afterPos - 1024;
      else {
        // Колонка пустая — first item, любое значение.
        newPos = 1024;
      }
      return {
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, status: input.targetStatus, position: newPos } : t,
        ),
      };
    });
    try {
      const updated = await taskRepository.move(projectId, taskId, input);
      setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)) }));
      notifyChanged();
    } catch (e) {
      // Откатываемся через refetch — проще чем хранить старое состояние.
      await refetch();
      throw e;
    }
  };

  const remove: UseTasks['remove'] = async (taskId) => {
    await taskRepository.delete(projectId, taskId);
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }));
    notifyChanged();
  };

  return { ...state, refetch, create, update, move, remove };
}
