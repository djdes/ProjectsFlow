import type { ProjectStatus } from '../../domain/project/Project.js';

// Read-model для admin-раздела. Проект — один раз (без дублей по members), с владельцем
// и счётчиками. Группировку по владельцу делает клиент (по ownerId).
export type AdminProjectView = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly ownerEmail: string;
  readonly memberCount: number;
  readonly taskCount: number;
  readonly createdAt: Date;
};

export type AdminUserView = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly isAdmin: boolean;
  readonly projectCount: number;
  // Сколько проектов где этот юзер OWNER (подмножество projectCount).
  // Нужно для UI «Делегация X/Y» — знаменатель.
  readonly ownedProjectCount: number;
  // Сколько из owned-проектов имеют git_token_delegation.enabled=true.
  // Числитель для UI «Делегация X/Y». 0 если ни одного.
  readonly delegationEnabledCount: number;
  // Подключён ли GitHub. Если нет — делегацию включать нельзя в принципе;
  // UI рисует это как hint.
  readonly githubConnected: boolean;
  readonly createdAt: Date;
};

export type AdminUpdateUserPatch = {
  readonly displayName?: string;
  readonly email?: string;
  readonly isAdmin?: boolean;
};

export interface AdminRepository {
  listAllProjects(): Promise<AdminProjectView[]>;
  listAllUsers(): Promise<AdminUserView[]>;
  updateUser(id: string, patch: AdminUpdateUserPatch): Promise<void>;
}
