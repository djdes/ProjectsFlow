import type { Task } from '../../domain/task/Task.js';
import { snapshotOfTask } from '../../domain/task/TaskVersion.js';
import type { TaskVersionRepository } from './TaskVersionRepository.js';

type Deps = {
  readonly versions: TaskVersionRepository;
  readonly idGen: () => string;
};

// Пишет снимок задачи в историю версий. ВСЕГДА best-effort: никогда не роняет основную
// операцию (создание/правку задачи) — как ActivityRecorder. Толерантен к отсутствию таблицы
// (до применения миграции db/092) — просто логирует и продолжает.
export class TaskVersionRecorder {
  constructor(private readonly deps: Deps) {}

  async record(task: Task, actorUserId: string | null): Promise<void> {
    try {
      await this.deps.versions.create({
        id: this.deps.idGen(),
        taskId: task.id,
        projectId: task.projectId,
        actorUserId,
        snapshot: snapshotOfTask(task),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TaskVersionRecorder] failed to record version', e);
    }
  }
}
