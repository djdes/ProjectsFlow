import type { Task } from '../../domain/task/Task.js';
import {
  changedTaskFields,
  snapshotOfTask,
  type TaskVersionField,
} from '../../domain/task/TaskVersion.js';
import type { TaskVersionRepository } from './TaskVersionRepository.js';

type Deps = {
  readonly versions: TaskVersionRepository;
  readonly idGen: () => string;
  readonly onRecorded?: (event: {
    readonly projectId: string;
    readonly taskId: string;
    readonly actorUserId: string | null;
    readonly changedFields: readonly TaskVersionField[];
    readonly createdAt: Date;
    readonly recipientUserIds: readonly string[];
  }) => void | Promise<void>;
};

// Пишет снимок задачи в историю версий. ВСЕГДА best-effort: никогда не роняет основную
// операцию (создание/правку задачи) — как ActivityRecorder. Толерантен к отсутствию таблицы
// (до применения миграции db/092) — просто логирует и продолжает.
export class TaskVersionRecorder {
  constructor(private readonly deps: Deps) {}

  async record(
    task: Task,
    actorUserId: string | null,
    previous: Task | null = null,
    explicitFields?: readonly TaskVersionField[],
  ): Promise<void> {
    const snapshot = snapshotOfTask(task);
    const changedFields = explicitFields ?? changedTaskFields(
      previous ? snapshotOfTask(previous) : null,
      snapshot,
    );
    if (changedFields.length === 0) return;
    const createdAt = new Date();
    try {
      await this.deps.versions.create({
        id: this.deps.idGen(),
        taskId: task.id,
        projectId: task.projectId,
        actorUserId,
        snapshot,
        changedFields,
        createdAt,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TaskVersionRecorder] failed to record version', e);
      return;
    }
    try {
      const publishing = this.deps.onRecorded?.({
        projectId: task.projectId,
        taskId: task.id,
        actorUserId,
        changedFields,
        createdAt,
        recipientUserIds: [
          ...new Set(
            [actorUserId, task.assignee.userId, previous?.assignee.userId]
              .filter((userId): userId is string => !!userId),
          ),
        ],
      });
      if (publishing) {
        void publishing.catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[TaskVersionRecorder] failed to publish version', e);
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TaskVersionRecorder] failed to publish version', e);
    }
  }
}
