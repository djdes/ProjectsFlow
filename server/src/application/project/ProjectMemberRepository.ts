import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { Project } from '../../domain/project/Project.js';
import type { User } from '../../domain/user/User.js';

export type ProjectMemberWithUser = ProjectMembership & {
  readonly user: User;
};

export type ProjectWithRole = Project & {
  readonly role: ProjectRole;
};

export type AddMemberInput = {
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
};

export interface ProjectMemberRepository {
  // Главный метод доступа: «может ли userId смотреть/менять projectId, и с какой ролью».
  // Возвращает null если юзер не member — use-case обычно мапит в ProjectNotFoundError (404).
  findForProject(projectId: string, userId: string): Promise<ProjectMembership | null>;

  // Список members проекта c user-данными (имя, аватар, email). Нужен для UI «Команда».
  listByProject(projectId: string): Promise<ProjectMemberWithUser[]>;

  // Проекты в которых юзер состоит, с его ролью. Используется в ListProjects.
  listProjectsForUser(userId: string): Promise<ProjectWithRole[]>;

  // Сколько owner'ов у проекта — для валидации «не понизь последнего owner'а».
  countOwners(projectId: string): Promise<number>;

  add(input: AddMemberInput): Promise<ProjectMembership>;
  remove(projectId: string, userId: string): Promise<boolean>;
  updateRole(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMembership | null>;
}
