import { useCallback, useMemo } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { RalphMode, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { runPool, type BulkResult, type BulkTaskActions } from './useBulkTaskActions';

// Задача верхнего блока «Входящих» — id плюс проект, которому она принадлежит.
export type CrossProjectTaskRef = { readonly id: string; readonly projectId: string };

// Массовые действия над задачами из РАЗНЫХ проектов (верхний блок «Входящих»).
//
// Отличие от useBulkTaskActions: там весь набор живёт в одном проекте и мутации идут
// через оптимистичный useTasks(projectId). Здесь единого projectId нет, а все task-
// эндпоинты project-scoped, поэтому действие разворачивается ВЕЕРОМ: каждый выбранный
// id резолвится в свой projectId и уходит отдельным запросом. Пул общий (не по группе
// на проект) — сервер всё равно видит независимые запросы, а общий пул держит
// предсказуемую конкуррентность на любой раскладке выбора.
//
// Оптимистичного локального патча нет намеренно: блок читает три независимых
// endpoint-списка, дешевле перечитать их один раз после пачки (onAfter), чем чинить
// зеркала руками. Частичный отказ считается честно — упавшие уходят в failed, и
// панель показывает «N из M», а не «готово».
export function useCrossProjectBulkActions(args: {
  // Выбранные задачи с их проектами.
  refs: readonly CrossProjectTaskRef[];
  // Перечитать источники после пачки (списки блока + нижняя доска).
  onAfter: () => Promise<void> | void;
}): BulkTaskActions {
  const { refs, onAfter } = args;
  const { taskRepository } = useContainer();

  // Панель оперирует голыми id — проект резолвим здесь.
  const projectOf = useMemo(
    () => new Map(refs.map((r) => [r.id, r.projectId] as const)),
    [refs],
  );

  // Общий каркас веера: развернуть id в пары (id, projectId), прогнать пулом,
  // перечитать источники.
  const fan = useCallback(
    async (
      ids: readonly string[],
      worker: (projectId: string, taskId: string) => Promise<void>,
    ): Promise<BulkResult> => {
      const pairs = ids.flatMap((id) => {
        const projectId = projectOf.get(id);
        return projectId === undefined ? [] : [{ id, projectId }];
      });
      // id, для которого проект не резолвится (список успел обновиться под руками),
      // — это не успех: считаем его упавшим, иначе тост соврал бы «все обновлены».
      const unresolved = ids.length - pairs.length;
      const res = await runPool(pairs, (p) => worker(p.projectId, p.id));
      await onAfter();
      return { ok: res.ok, failed: res.failed + unresolved };
    },
    [projectOf, onAfter],
  );

  const setPriority = useCallback(
    (ids: string[], priority: TaskPriority | null) =>
      fan(ids, (projectId, taskId) =>
        taskRepository.update(projectId, taskId, { priority }).then(() => undefined),
      ),
    [fan, taskRepository],
  );

  const setDeadline = useCallback(
    (ids: string[], deadline: string | null) =>
      fan(ids, (projectId, taskId) =>
        taskRepository.update(projectId, taskId, { deadline }).then(() => undefined),
      ),
    [fan, taskRepository],
  );

  const setRalphMode = useCallback(
    (ids: string[], mode: RalphMode) =>
      fan(ids, (projectId, taskId) =>
        taskRepository.update(projectId, taskId, { ralphMode: mode }).then(() => undefined),
      ),
    [fan, taskRepository],
  );

  // Ответственный резолвится по участникам ПРОСТРАНСТВА (панель грузит shared-members),
  // а членство проверяет сервер каждого проекта. Задача в проекте, где выбранного
  // человека нет, честно упадёт и попадёт в failed — ровно как drag на кубик участника.
  const assign = useCallback(
    (ids: string[], assigneeUserId: string) =>
      fan(ids, (projectId, taskId) =>
        taskRepository.assign(projectId, taskId, assigneeUserId).then(() => undefined),
      ),
    [fan, taskRepository],
  );

  // Смена колонки в блоке недоступна (панель гасит кнопку: у каждого проекта свои
  // названия колонок). Реализация оставлена, чтобы тип BulkTaskActions был полным и
  // действие заработало сразу, если панель когда-нибудь получит цели.
  const moveToColumn = useCallback(
    async (ids: string[], targetStatus: TaskStatus) => {
      // Последовательно: move пересчитывает позиции, параллельные запросы по одному
      // проекту конкурировали бы за них.
      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        const projectId = projectOf.get(id);
        if (projectId === undefined) {
          failed += 1;
          continue;
        }
        try {
          await taskRepository.move(projectId, id, {
            targetStatus,
            beforeTaskId: null,
            afterTaskId: null,
          });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      await onAfter();
      return { ok, failed };
    },
    [projectOf, taskRepository, onAfter],
  );

  const remove = useCallback(
    (ids: string[]) =>
      fan(ids, (projectId, taskId) => taskRepository.delete(projectId, taskId)),
    [fan, taskRepository],
  );

  return { setPriority, setDeadline, setRalphMode, assign, moveToColumn, remove };
}
