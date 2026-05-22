import type { ProjectMemberRepository } from './ProjectMemberRepository.js';

export type ReorderProjectsCommand = {
  readonly userId: string;
  readonly orderedIds: readonly string[];
};

type Deps = {
  readonly members: ProjectMemberRepository;
};

// Персональная пересортировка проектов в сайдбаре. Право — быть участником: каждый
// меняет только свой порядок (sort_order на project_members), поэтому отдельная проверка
// роли не нужна. id, по которым у юзера нет membership, репозиторий игнорирует.
export class ReorderProjects {
  constructor(private readonly deps: Deps) {}

  execute(cmd: ReorderProjectsCommand): Promise<void> {
    return this.deps.members.reorderForUser(cmd.userId, cmd.orderedIds);
  }
}
