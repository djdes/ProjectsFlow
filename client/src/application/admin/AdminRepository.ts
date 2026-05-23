import type { ProjectStatus } from '@/domain/project/Project';

export type AdminProject = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly ownerEmail: string;
  readonly memberCount: number;
  readonly taskCount: number;
};

export type AdminUser = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly isAdmin: boolean;
  readonly projectCount: number;
};

export type AdminUserPatch = {
  readonly displayName?: string;
  readonly email?: string;
  readonly isAdmin?: boolean;
};

// Проект юзера + его текущий диспетчер (с резолвом имён). Используется
// admin-страницей в колонке «Проекты / Диспетчеры».
export type AdminUserProjectDispatcher = {
  readonly projectId: string;
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly isInbox: boolean;
  readonly dispatcherUserId: string | null;
  readonly dispatcherDisplayName: string | null;
  readonly dispatcherEmail: string | null;
};

export interface AdminRepository {
  listProjects(): Promise<AdminProject[]>;
  listUsers(): Promise<AdminUser[]>;
  updateUser(id: string, patch: AdminUserPatch): Promise<void>;
  // Проекты юзера (где он owner) + текущие диспетчеры. Сменить диспетчера
  // admin может через обычный `projectRepository.setDispatcher` (admin-bypass).
  listUserProjectsWithDispatcher(userId: string): Promise<AdminUserProjectDispatcher[]>;
}
