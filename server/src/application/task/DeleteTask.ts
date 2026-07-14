import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import { requireTaskDeleteAccess } from './taskAuthorization.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
};

export class DeleteTask {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, taskId: string): Promise<void> {
    await requireTaskDeleteAccess(this.deps, projectId, ownerUserId, 'delete_task');

    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    // Атомарно: задача + все её child-строки (комментарии, аттачи, коммиты, версии,
    // legacy-история назначений, live-сессии/события, telegram-маппинги,
    // email-токены) в одной TX (B2/B3).
    // Раньше комментарии чистились отдельным запросом, а attachments/commits/versions
    // оставались сиротами; крэш между шагами оставлял несогласованное состояние.
    const ok = await this.deps.tasks.deleteWithChildren(taskId);
    if (!ok) throw new TaskNotFoundError(taskId);

    // Лента действий (best-effort).
    void this.deps.activityRecorder?.record({
      projectId,
      actorUserId: ownerUserId,
      kind: 'task_deleted',
      payload: { taskId, taskExcerpt: (task.description ?? '').slice(0, 120) },
    });
  }
}
