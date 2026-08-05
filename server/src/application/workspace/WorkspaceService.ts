import type {
  Workspace,
  WorkspaceCommitSyncMode,
  WorkspaceKind,
} from '../../domain/workspace/Workspace.js';
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '../../domain/workspace/WorkspaceMember.js';
import {
  WorkspaceNameEmptyError,
  WorkspaceNotFoundError,
  NotWorkspaceMemberError,
  NotWorkspaceOwnerError,
  NotProjectOwnerError,
  LastOwnerError,
  WorkspaceNotEmptyError,
  CannotDeleteLastWorkspaceError,
  CannotDeleteDefaultWorkspaceError,
  UserNotFoundByEmailError,
} from '../../domain/workspace/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import {
  requireWorkspaceMember,
  requireWorkspaceOwner,
} from './workspaceAccess.js';
import type {
  WorkspaceRepository,
  WorkspaceListItem,
} from './WorkspaceRepository.js';

// Узкие структурные порты — нужны только методы ниже; реальные репозитории их содержат.
type ProjectsPort = {
  getById(id: string): Promise<{ id: string; ownerId: string } | null>;
  getWorkspaceId(projectId: string): Promise<string | null>;
  setWorkspace(projectId: string, workspaceId: string): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<ReadonlyArray<{ id: string; name: string; icon: string | null }>>;
  // Полный список, включая личные inbox-проекты (см. ProjectRepository.listAllByWorkspace).
  listAllByWorkspace?(
    workspaceId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; icon: string | null }>>;
};
type UsersPort = {
  getByEmail(email: string): Promise<{ id: string } | null>;
};
// Выключение воркера уводит задачи из его колонки в черновики — нужен ровно один метод.
type TasksPort = {
  bulkChangeStatus(
    projectIds: readonly string[],
    from: 'todo',
    to: 'backlog',
  ): Promise<number>;
};

type Deps = {
  readonly repo: WorkspaceRepository;
  readonly projects: ProjectsPort;
  readonly users: UsersPort;
  // Опционален: без него тумблер воркера просто не перекладывает задачи (старые сборки/тесты).
  readonly tasks?: TasksPort;
  readonly idGen: () => string;
};

export class WorkspaceService {
  constructor(private readonly deps: Deps) {}

  listForUser(userId: string): Promise<WorkspaceListItem[]> {
    return this.deps.repo.listForUser(userId);
  }

  getCurrentWorkspaceId(userId: string): Promise<string | null> {
    return this.deps.repo.getCurrentWorkspaceId(userId);
  }

  /** Проекты пространства (для страницы настроек). Только участник пространства. */
  async listProjects(
    workspaceId: string,
    userId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; icon: string | null }>> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    return this.deps.projects.listByWorkspace(workspaceId);
  }

  // kind по умолчанию 'team' (ручное создание из UI — командное пространство).
  // Дефолт-хаб юзера создаётся при регистрации с kind='default' (см. createDefaultWorkspace).
  async create(
    userId: string,
    input: { name: string; icon: string | null; kind?: WorkspaceKind },
  ): Promise<Workspace> {
    const name = input.name.trim();
    if (name.length === 0) throw new WorkspaceNameEmptyError();
    const ws = await this.deps.repo.createWithOwnerMembership({
      id: this.deps.idGen(),
      name,
      icon: input.icon ?? null,
      kind: input.kind ?? 'team',
      ownerUserId: userId,
    });
    await this.deps.repo.setCurrentWorkspace(userId, ws.id);
    return ws;
  }

  async rename(
    workspaceId: string,
    userId: string,
    patch: { name?: string; icon?: string | null },
  ): Promise<Workspace> {
    // Название и иконка принадлежат всему общему пространству: менять их может
    // любой его участник, включая viewer. Управление ролями и удаление остаются
    // отдельными owner-only действиями ниже.
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    let name: string | undefined;
    if (patch.name !== undefined) {
      name = patch.name.trim();
      if (name.length === 0) throw new WorkspaceNameEmptyError();
    }
    const updated = await this.deps.repo.update(workspaceId, { name, icon: patch.icon });
    if (!updated) throw new WorkspaceNotFoundError();
    return updated;
  }

  // Приёмка задач руководителем (db/150). Настройка управленческая: включать её может
  // только руководитель или владелец пространства — не рядовой участник, которого она
  // как раз и ограничивает.
  /**
   * Режим сверки коммитов в пространстве (db/155). Право — как у приёмки и воркера:
   * lead/owner. Настройка управленческая, действует на доски и уведомления всей команды.
   *
   * Задачи никуда не переезжают: режим влияет только на будущие прогоны сверки
   * (см. CommitSyncPolicy), а уже созданные job'ы несут снимок своего действия.
   */
  async setCommitSyncMode(
    workspaceId: string,
    actorId: string,
    mode: WorkspaceCommitSyncMode,
  ): Promise<Workspace> {
    const member = await requireWorkspaceMember(this.deps.repo, workspaceId, actorId);
    if (member.role !== 'owner' && member.role !== 'lead') throw new NotWorkspaceOwnerError();
    const updated = await this.deps.repo.update(workspaceId, { commitSyncMode: mode });
    if (!updated) throw new WorkspaceNotFoundError();
    return updated;
  }

  async setTaskApproval(
    workspaceId: string,
    actorId: string,
    enabled: boolean,
  ): Promise<Workspace> {
    const member = await requireWorkspaceMember(this.deps.repo, workspaceId, actorId);
    if (member.role !== 'owner' && member.role !== 'lead') throw new NotWorkspaceOwnerError();
    const updated = await this.deps.repo.update(workspaceId, { requireTaskApproval: enabled });
    if (!updated) throw new WorkspaceNotFoundError();
    return updated;
  }

  /**
   * Тумблер воркера в пространстве (db/152). Право — как у приёмки: lead/owner.
   *
   * Выключение уводит задачи из колонки «Воркер» ('todo') в «Черновики» по ВСЕМ проектам
   * пространства, включая личные входящие участников: колонка исчезает с досок, и задачи,
   * оставленные в ней, исчезли бы вместе с ней — человек считал бы их потерянными.
   * Обратное включение задачи не возвращает: где им место после выключения, знает команда,
   * а не сервер.
   */
  async setWorkerEnabled(
    workspaceId: string,
    actorId: string,
    enabled: boolean,
  ): Promise<{ workspace: Workspace; movedTaskCount: number }> {
    const member = await requireWorkspaceMember(this.deps.repo, workspaceId, actorId);
    if (member.role !== 'owner' && member.role !== 'lead') throw new NotWorkspaceOwnerError();

    let movedTaskCount = 0;
    if (!enabled && this.deps.tasks) {
      // Личные входящие тоже живут в пространстве и тоже показывают колонку «Воркер»,
      // поэтому берём полный список проектов, а не UI-срез listByWorkspace.
      const projects = this.deps.projects.listAllByWorkspace
        ? await this.deps.projects.listAllByWorkspace(workspaceId)
        : await this.deps.projects.listByWorkspace(workspaceId);
      if (projects.length > 0) {
        movedTaskCount = await this.deps.tasks.bulkChangeStatus(
          projects.map((p) => p.id),
          'todo',
          'backlog',
        );
      }
    }

    const updated = await this.deps.repo.update(workspaceId, { workerEnabled: enabled });
    if (!updated) throw new WorkspaceNotFoundError();
    return { workspace: updated, movedTaskCount };
  }

  async switchCurrent(userId: string, workspaceId: string): Promise<void> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    await this.deps.repo.setCurrentWorkspace(userId, workspaceId);
  }

  async listMembers(workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    return this.deps.repo.listMembers(workspaceId);
  }

  async addMember(
    workspaceId: string,
    actorId: string,
    email: string,
    role: WorkspaceRole = 'editor',
  ): Promise<WorkspaceMember> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, actorId);
    const user = await this.deps.users.getByEmail(email.trim());
    if (!user) throw new UserNotFoundByEmailError(email);
    await this.deps.repo.addMember(workspaceId, user.id, role);
    // Мёржим личный дефолт-хаб добавленного юзера в это командное пространство (durability,
    // см. AcceptWorkspaceInvite для того же вызова на пути accept-invite). Идемпотентно.
    await this.deps.repo.absorbDefaultHubInto(user.id, workspaceId);
    const m = await this.deps.repo.getMembership(workspaceId, user.id);
    if (!m) throw new WorkspaceNotFoundError();
    return m;
  }

  async changeMemberRole(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, actorId);
    const target = await this.deps.repo.getMembership(workspaceId, targetUserId);
    if (!target) throw new NotWorkspaceMemberError();
    // Понижение owner'а до editor/viewer: нельзя оставить пространство без владельца.
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await this.deps.repo.countOwners(workspaceId);
      if (owners <= 1) throw new LastOwnerError();
    }
    await this.deps.repo.setMemberRole(workspaceId, targetUserId, role);
  }

  async removeMember(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, actorId);
    const target = await this.deps.repo.getMembership(workspaceId, targetUserId);
    if (!target) throw new NotWorkspaceMemberError();
    if (target.role === 'owner') {
      const owners = await this.deps.repo.countOwners(workspaceId);
      if (owners <= 1) throw new LastOwnerError();
    }
    await this.deps.repo.removeMember(workspaceId, targetUserId);
    // Если у удалённого это было активное пространство — переключаем на другое.
    const current = await this.deps.repo.getCurrentWorkspaceId(targetUserId);
    if (current === workspaceId) {
      const another = await this.deps.repo.findAnotherForUser(targetUserId, workspaceId);
      if (another) await this.deps.repo.setCurrentWorkspace(targetUserId, another);
    }
  }

  async moveProject(
    workspaceId: string,
    userId: string,
    projectId: string,
    targetWorkspaceId: string,
  ): Promise<void> {
    await requireWorkspaceMember(this.deps.repo, workspaceId, userId);
    await requireWorkspaceMember(this.deps.repo, targetWorkspaceId, userId);
    const project = await this.deps.projects.getById(projectId);
    if (!project) throw new ProjectNotFoundError();
    // Проект должен реально лежать в исходном пространстве из URL (не доверяем path-сегменту).
    const sourceWorkspaceId = await this.deps.projects.getWorkspaceId(projectId);
    if (sourceWorkspaceId !== workspaceId) throw new ProjectNotFoundError();
    if (project.ownerId !== userId) throw new NotProjectOwnerError();
    await this.deps.projects.setWorkspace(projectId, targetWorkspaceId);
    // Участники НЕ копируются: доступ к проекту деривится из workspace_members целевого
    // пространства (спека unified-workspace §3.2) — перенос просто меняет аудиторию.
  }

  async deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
    await requireWorkspaceOwner(this.deps.repo, workspaceId, userId);
    // Дефолт-хаб неудаляем — это «всё моё» представление, всегда должно существовать.
    const ws = await this.deps.repo.getById(workspaceId);
    if (ws?.kind === 'default') throw new CannotDeleteDefaultWorkspaceError();
    const projects = await this.deps.repo.projectCount(workspaceId);
    if (projects > 0) throw new WorkspaceNotEmptyError();
    const total = await this.deps.repo.countForUser(userId);
    if (total <= 1) throw new CannotDeleteLastWorkspaceError();
    await this.deps.repo.delete(workspaceId);
    // current_workspace_id обнуляется ON DELETE SET NULL — переключаем на другое явно.
    const current = await this.deps.repo.getCurrentWorkspaceId(userId);
    if (current === null || current === workspaceId) {
      const another = await this.deps.repo.findAnotherForUser(userId, workspaceId);
      if (another) await this.deps.repo.setCurrentWorkspace(userId, another);
    }
  }
}
