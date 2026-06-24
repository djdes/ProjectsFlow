import type { Project } from '../../domain/project/Project.js';
import { ProjectNameEmptyError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

export type CreateProjectCommand = {
  readonly ownerId: string;
  readonly name: string;
};

type Deps = {
  readonly repo: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly idGen: () => string;
  // Активное пространство владельца — новый проект создаётся в нём. Бросает если нет пространства.
  readonly resolveWorkspaceId: (ownerId: string) => Promise<string>;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
  // Опциональная политика «авто-дефолт Ralph-диспетчера на новый проект».
  // Возвращает userId дежурного admin'а (с активным токеном) либо null —
  // тогда проект остаётся без диспетчера (ручной режим). Best-effort: если
  // резолвер бросит ошибку — НЕ роняем создание проекта, просто пропускаем.
  readonly resolveDefaultDispatcher?: () => Promise<string | null>;
};

export class CreateProject {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: CreateProjectCommand): Promise<Project> {
    const name = cmd.name.trim();
    if (name.length === 0) throw new ProjectNameEmptyError();
    // АТОМАРНО: project + owner-membership в одной TX (см. createWithOwnerMembership).
    // Раньше create() и members.add() шли последовательно — если member.add падал,
    // проект оставался orphan'ом без доступа никому, включая создателя.
    const workspaceId = await this.deps.resolveWorkspaceId(cmd.ownerId);
    const project = await this.deps.repo.createWithOwnerMembership({
      id: this.deps.idGen(),
      ownerId: cmd.ownerId,
      name,
      workspaceId,
    });

    // Лента действий (best-effort). workspaceId уже известен — без лишнего lookup.
    void this.deps.activityRecorder?.record({
      projectId: project.id,
      actorUserId: cmd.ownerId,
      kind: 'project_created',
      payload: { projectName: name },
      workspaceId,
    });

    // Auto-default Ralph-диспетчера на дежурного admin'а (с активным agent-токеном).
    // Best-effort: ошибка резолвера или update'а НЕ роняет создание проекта — проект уже
    // существует, юзер ждёт 201. Inbox сюда не попадает: он создаётся отдельно через
    // GetOrCreateInbox.repo.create() в обход этого use-case'а.
    if (this.deps.resolveDefaultDispatcher) {
      try {
        const dispatcherUserId = await this.deps.resolveDefaultDispatcher();
        if (dispatcherUserId) {
          const updated = await this.deps.repo.update(project.id, { dispatcherUserId });
          if (updated) return updated;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[CreateProject] failed to set default dispatcher:', e);
      }
    }

    return project;
  }
}
