import { AssigneeNotSharedMemberError } from '../../domain/task/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { ProjectNameAlreadyExistsError } from '../../domain/project/errors.js';

type Deps = {
  readonly repo: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly idGen: () => string;
  // Активное пространство владельца — inbox создаётся в нём (projects.workspace_id NOT NULL).
  readonly resolveWorkspaceId: (ownerId: string) => Promise<string>;
};

// Лениво находит или создаёт inbox-проект пользователя. Идемпотентно: если уже есть —
// возвращает существующий; иначе создаёт с name='Входящие' и isInbox=true + сразу
// добавляет owner-membership (без этого никакие task-use-case'ы не пройдут access-check).
// Используется одним endpoint'ом GET /api/inbox.
//
// Имя 'Входящие' формально может конфликтовать с обычным проектом юзера с таким же name'ом
// (unique по owner_id+name). Если юзер сам создал «Входящие» как обычный проект — inbox
// возьмёт имя 'Входящие (системный)'. Случай редкий, обработка примитивная.
export class GetOrCreateInbox {
  constructor(private readonly deps: Deps) {}

  async execute(ownerId: string, actorUserId = ownerId): Promise<Project> {
    const workspaceId = await this.deps.resolveWorkspaceId(actorUserId);
    if (actorUserId !== ownerId) {
      const colleagues = await this.deps.members.listSharedUsersInWorkspace(actorUserId, workspaceId);
      if (!colleagues.some((member) => member.id === ownerId)) throw new AssigneeNotSharedMemberError();
    }
    const existing = await this.deps.repo.findInboxByOwner(ownerId, workspaceId);
    if (existing) return existing;
    // The database enforces one inbox per owner AND workspace. Concurrent tabs can
    // race this GET: read the winner, or retry a name taken by a different owner.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.deps.repo.createWithOwnerMembership({
          id: this.deps.idGen(), ownerId, workspaceId, isInbox: true,
          name: await this.pickAvailableName(ownerId, workspaceId),
        });
      } catch (error) {
        if (!(error instanceof ProjectNameAlreadyExistsError)) throw error;
        const winner = await this.deps.repo.findInboxByOwner(ownerId, workspaceId);
        if (winner) return winner;
        if (attempt === 3) throw error;
      }
    }
    throw new Error('Inbox creation did not complete');
  }

  // Имя обязано пройти ОБА unique-индекса: (owner_id, name) из db/002 и (workspace_id, name)
  // из db/073. Раньше проверялся только первый — по списку проектов самого владельца, — и
  // второй человек в командном пространстве упирался в 409 project_name_taken: чужой inbox
  // с именем 'Входящие' в его список не входит, а индекс по пространству про него знает.
  // «Личные» без inbox'а не открывались вообще.
  private async pickAvailableName(ownerId: string, workspaceId: string): Promise<string> {
    const [mine, inWorkspace] = await Promise.all([
      this.deps.members.listProjectsForUser(ownerId),
      this.deps.repo.listProjectNamesInWorkspace(workspaceId),
    ]);
    const taken = new Set([...mine.map((p) => p.name), ...inWorkspace]);
    const candidates = ['Входящие', 'Входящие (системный)', 'Входящие (inbox)'];
    const free = candidates.find((c) => !taken.has(c));
    if (free) return free;
    // Дальше — суффикс по владельцу, а не timestamp: имя детерминированное, повторный
    // вызов после сбоя даст то же самое, а не плодит «Входящие (17860…)».
    const byOwner = `Входящие (${ownerId.slice(0, 8)})`;
    if (!taken.has(byOwner)) return byOwner;
    const base = `Входящие (${ownerId.slice(0, 8)} · ${workspaceId.slice(0, 8)})`;
    let candidate = base;
    for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base} ${suffix}`;
    return candidate;
  }
}
