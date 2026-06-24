// Синхронизация участников дефолт-хаба владельца проекта с участниками его проектов.
//
// Дефолт-хаб (workspaces.kind='default') держит ОДНУ общую комнату-чат, участники которой =
// владелец + все, с кем у него есть общий проект. Чтобы при вступлении/выходе из проекта
// состав чата оставался точным, эти точки дёргают синк:
//  • onMemberAdded   — юзер вошёл в проект → добавить его в хаб владельца (идемпотентно).
//  • onMemberRemoved — юзер вышел из проекта → убрать из хаба владельца, ЕСЛИ у них больше
//    нет общих проектов.
//
// Всё best-effort: синк не должен ломать основной сценарий (вступление/удаление в проекте).
// Вызывающие оборачивают вызовы в try/catch. Владельца из его собственного хаба не трогаем.

type ProjectsPort = {
  getById(id: string): Promise<{ id: string; ownerId: string } | null>;
};

type MembersPort = {
  isMemberOfAnyProjectOwnedBy(userId: string, ownerUserId: string): Promise<boolean>;
};

type WorkspacesPort = {
  findDefaultForOwner(ownerUserId: string): Promise<string | null>;
  addMember(workspaceId: string, userId: string, role: 'owner' | 'member'): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;
};

type Deps = {
  readonly projects: ProjectsPort;
  readonly members: MembersPort;
  readonly workspaces: WorkspacesPort;
};

export class HubMembershipSync {
  constructor(private readonly deps: Deps) {}

  /** Юзер вступил в проект → участник хаб-чата владельца проекта. */
  async onMemberAdded(projectId: string, userId: string): Promise<void> {
    const project = await this.deps.projects.getById(projectId);
    if (!project) return;
    if (project.ownerId === userId) return; // владелец уже в своём хабе как owner
    const hubId = await this.deps.workspaces.findDefaultForOwner(project.ownerId);
    if (!hubId) return;
    await this.deps.workspaces.addMember(hubId, userId, 'member'); // идемпотентно
  }

  /** Юзер вышел из проекта → убрать из хаба владельца, если общих проектов больше нет. */
  async onMemberRemoved(projectId: string, userId: string): Promise<void> {
    const project = await this.deps.projects.getById(projectId);
    if (!project) return;
    if (project.ownerId === userId) return; // владельца из его хаба не убираем
    const hubId = await this.deps.workspaces.findDefaultForOwner(project.ownerId);
    if (!hubId) return;
    const stillShares = await this.deps.members.isMemberOfAnyProjectOwnedBy(
      userId,
      project.ownerId,
    );
    if (!stillShares) await this.deps.workspaces.removeMember(hubId, userId);
  }
}
