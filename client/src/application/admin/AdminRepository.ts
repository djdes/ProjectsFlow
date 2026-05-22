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

export interface AdminRepository {
  listProjects(): Promise<AdminProject[]>;
  listUsers(): Promise<AdminUser[]>;
  updateUser(id: string, patch: AdminUserPatch): Promise<void>;
}
