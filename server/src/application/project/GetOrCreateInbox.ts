import type { Project } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly repo: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly idGen: () => string;
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

  async execute(ownerId: string): Promise<Project> {
    const existing = await this.deps.repo.findInboxByOwner(ownerId);
    if (existing) return existing;

    const name = await this.pickAvailableName(ownerId);
    // Атомарно (см. createWithOwnerMembership): иначе крэш между create и members.add
    // оставлял бы inbox без owner-membership и юзер не мог бы видеть свой inbox.
    const project = await this.deps.repo.createWithOwnerMembership({
      id: this.deps.idGen(),
      ownerId,
      name,
      isInbox: true,
    });
    return project;
  }

  private async pickAvailableName(ownerId: string): Promise<string> {
    const candidates = ['Входящие', 'Входящие (системный)', 'Входящие (inbox)'];
    const list = await this.deps.members.listProjectsForUser(ownerId);
    const taken = new Set(list.map((p) => p.name));
    const free = candidates.find((c) => !taken.has(c));
    if (free) return free;
    // Совсем уж редкий fallback с timestamp'ом.
    return `Входящие (${Date.now()})`;
  }
}
