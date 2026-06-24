import type { Workspace, WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';

export type CreateWorkspaceInput = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly ownerUserId: string;
  // По умолчанию 'team' (ручное создание). Дефолт-хаб юзера создаётся с kind='default'.
  readonly kind?: WorkspaceKind;
};

export type UpdateWorkspaceInput = {
  readonly name?: string;
  readonly icon?: string | null;
};

// Пространство в списке для юзера: + его роль и счётчик проектов (read-model).
export type WorkspaceListItem = Workspace & {
  readonly role: WorkspaceRole;
  readonly projectCount: number;
};

export interface WorkspaceRepository {
  /** Пространства, где юзер — участник, с его ролью и числом проектов. */
  listForUser(userId: string): Promise<WorkspaceListItem[]>;
  getById(id: string): Promise<Workspace | null>;
  /** Дефолт-хаб владельца (kind='default'), либо null. Для синка участников хаб-чата. */
  findDefaultForOwner(ownerUserId: string): Promise<string | null>;
  /** Транзакция: создать пространство + owner-membership создателя. */
  createWithOwnerMembership(input: CreateWorkspaceInput): Promise<Workspace>;
  update(id: string, patch: UpdateWorkspaceInput): Promise<Workspace | null>;
  delete(id: string): Promise<void>;
  countForUser(userId: string): Promise<number>;
  projectCount(workspaceId: string): Promise<number>;

  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  /** Участники с обогащением (displayName/email/avatarUrl из users). */
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  countOwners(workspaceId: string): Promise<number>;
  /** Идемпотентно: если уже участник — не падает (дубликат игнорируется). */
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;

  setCurrentWorkspace(userId: string, workspaceId: string): Promise<void>;
  getCurrentWorkspaceId(userId: string): Promise<string | null>;
  /** Любое другое пространство юзера, кроме excludeId (для авто-switch). */
  findAnotherForUser(userId: string, excludeId: string): Promise<string | null>;
}
