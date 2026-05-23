import { CannotDeleteInboxError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { AttachmentStorage } from '../task/AttachmentStorage.js';
import type { TaskAttachmentRepository } from '../task/TaskAttachmentRepository.js';
import type { ProjectMemberRepository, ProjectMemberWithUser } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly storage: AttachmentStorage;
};

export type DeleteProjectResult = {
  // Снимок данных удалённого проекта — нужен presentation-слою, чтобы дёрнуть
  // notifier (рассылка email'ов оставшимся участникам). После execute() в БД
  // этих сущностей уже нет, поэтому возвращаем их явно.
  readonly project: Project;
  readonly memberIdsBeforeDelete: readonly string[];
  readonly memberSnapshots: readonly ProjectMemberWithUser[];
};

// Безвозвратное удаление проекта со всеми child-данными (см. ProjectRepository.deleteCascade).
// owner-only (через requireProjectAccess(..., 'delete_project')). Inbox-проект запрещён.
//
// Что мы НЕ удаляем намеренно (см. дизайн):
//   - подключённый GitHub-репо / github-KB-репо: внешние ресурсы, юзер ими управляет в GitHub.
//   - employees: owner-scoped, шарятся между проектами одного владельца.
//   - notifications: user-scoped; старые ссылки на удалённый проект делают soft-fallback.
export class DeleteProject {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, actorUserId: string): Promise<DeleteProjectResult> {
    // 1. Авторизация + получение project'а в одном lookup'е.
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      actorUserId,
      'delete_project',
    );
    if (project.isInbox) throw new CannotDeleteInboxError();

    // 2. Снимок участников ДО удаления — нужен notifier'у в presentation-слое.
    const memberSnapshots = await this.deps.members.listByProject(projectId);
    const memberIdsBeforeDelete = memberSnapshots.map((m) => m.userId);

    // 3. Storage-ключи аттачей — собираем ДО транзакции, чтобы после неё best-effort
    //    удалить файлы с диска (БД rows уйдут вместе с транзакцией).
    const storageKeys = await this.deps.attachments.listStorageKeysByProject(projectId);

    // 4. Каскадное удаление в одной транзакции (всё-или-ничего по БД).
    await this.deps.projects.deleteCascade(projectId);

    // 5. Файлы с диска — fire-and-forget. Ошибки логируем, удаление проекта
    //    считается успешным даже если на диске остались orphan'ы (cron почистит).
    for (const key of storageKeys) {
      this.deps.storage.delete(key).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[DeleteProject] failed to delete attachment ${key}:`, err);
      });
    }

    return { project, memberIdsBeforeDelete, memberSnapshots };
  }
}
