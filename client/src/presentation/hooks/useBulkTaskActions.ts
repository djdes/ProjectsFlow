import { useCallback } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { RalphMode, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { UseTasks } from './useTasks';

// Результат массовой операции: сколько успешно / сколько упало. UI показывает
// «N из M» в toast'е, частичная ошибка не валит всю пачку.
export type BulkResult = { ok: number; failed: number };

// Гоняет worker'ы пулом с ограниченной конкуррентностью; собирает ok/failed.
// Дженерик по элементу: «Входящие» гоняют пары (id, projectId), см.
// useCrossProjectBulkActions.
export async function runPool<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  concurrency = 5,
): Promise<BulkResult> {
  let ok = 0;
  let failed = 0;
  let cursor = 0;
  const runOne = async (): Promise<void> => {
    for (;;) {
      const item = items[cursor++];
      if (item === undefined) return;
      try {
        await worker(item);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
  };
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(lanes);
  return { ok, failed };
}

export type BulkTaskActions = {
  setPriority: (ids: string[], priority: TaskPriority | null) => Promise<BulkResult>;
  setDeadline: (ids: string[], deadline: string | null) => Promise<BulkResult>;
  setRalphMode: (ids: string[], mode: RalphMode) => Promise<BulkResult>;
  assign: (ids: string[], assigneeUserId: string) => Promise<BulkResult>;
  moveToColumn: (ids: string[], targetStatus: TaskStatus) => Promise<BulkResult>;
  remove: (ids: string[]) => Promise<BulkResult>;
};

// Массовые действия над выбранными задачами поверх существующих one-task методов
// useTasks (оптимистичные update/move/remove) + taskRepository.assign. Серверных
// bulk-эндпоинтов нет — это осознанный trade-off (см. spec, Фаза 1, решение 4).
export function useBulkTaskActions(args: {
  projectId: string;
  update: UseTasks['update'];
  move: UseTasks['move'];
  remove: UseTasks['remove'];
  refetch: UseTasks['refetch'];
}): BulkTaskActions {
  const { projectId, update, move, remove, refetch } = args;
  const { taskRepository } = useContainer();

  const setPriority = useCallback(
    (ids: string[], priority: TaskPriority | null) =>
      runPool(ids, async (id) => {
        await update(id, { priority });
      }),
    [update],
  );

  const setDeadline = useCallback(
    (ids: string[], deadline: string | null) =>
      runPool(ids, async (id) => {
        await update(id, { deadline });
      }),
    [update],
  );

  const setRalphMode = useCallback(
    (ids: string[], mode: RalphMode) =>
      runPool(ids, async (id) => {
        await update(id, { ralphMode: mode });
      }),
    [update],
  );

  const assign = useCallback(
    async (ids: string[], assigneeUserId: string) => {
      const res = await runPool(ids, async (id) => {
        await taskRepository.assign(projectId, id, assigneeUserId);
      });
      await refetch();
      return res;
    },
    [taskRepository, projectId, refetch],
  );

  const moveToColumn = useCallback(
    async (ids: string[], targetStatus: TaskStatus) => {
      // move оптимистично пересчитывает position локально; гоняем последовательно,
      // чтобы параллельные апдейты позиций не конкурировали. before/after=null —
      // ровно как TaskDrawer.onMove (проверенный путь смены колонки).
      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await move(id, { targetStatus, beforeTaskId: null, afterTaskId: null });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      return { ok, failed };
    },
    [move],
  );

  const removeMany = useCallback(
    (ids: string[]) =>
      runPool(
        ids,
        async (id) => {
          await remove(id);
        },
        4,
      ),
    [remove],
  );

  return { setPriority, setDeadline, setRalphMode, assign, moveToColumn, remove: removeMany };
}
