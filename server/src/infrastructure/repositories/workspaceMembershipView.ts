// Чистая логика «членство проекта через пространство» (спека unified-workspace §3.2).
// Вынесена из DrizzleProjectMemberRepository, чтобы инвариант приватности Входящих
// был покрыт unit-тестами без реальной БД.
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';

// Минимальный срез строки projects, нужный для резолва доступа.
export type ProjectAccessRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly isInbox: boolean;
  readonly createdAt: Date;
};

// Строка workspace_members. Роль маппится в роль проекта 1:1 (owner→owner и т.д.).
export type WorkspaceMemberAccessRow = {
  readonly userId: string;
  readonly role: ProjectRole;
  readonly createdAt: Date;
};

/**
 * Единый предикат «виден ли проект юзеру и с какой ролью» — источник истины и для
 * findForProject, и для листингов (listProjectsForUser/InWorkspace, listByProject).
 * Возвращает `null`, если проект юзеру не виден.
 *
 * Инвариант приватности Входящих: is_inbox виден ТОЛЬКО владельцу (projects.owner_id),
 * роль всегда 'owner', НЕЗАВИСИМО от ws-членства (владелец видит свой inbox, даже если
 * его убрали из пространства). Не-inbox виден участнику пространства с его ws-ролью 1:1.
 * Делегаты видят отдельные inbox-задачи через taskAuthorization, но НЕ через членство.
 */
export function projectRowVisibility(
  project: Pick<ProjectAccessRow, 'isInbox' | 'ownerId'>,
  userId: string,
  wsMember: Pick<WorkspaceMemberAccessRow, 'role'> | null,
): { readonly role: ProjectRole } | null {
  if (project.isInbox) {
    return project.ownerId === userId ? { role: 'owner' } : null;
  }
  if (!wsMember) return null;
  return { role: wsMember.role };
}

/**
 * Членство юзера в проекте, дериватив от членства в пространстве. Надстройка над
 * projectRowVisibility: добавляет joinedAt (для своего inbox — момент создания проекта,
 * ws-строки может не быть; для не-inbox — момент вступления в пространство).
 */
export function deriveMembership(
  project: ProjectAccessRow,
  userId: string,
  wsMember: WorkspaceMemberAccessRow | null,
): ProjectMembership | null {
  const vis = projectRowVisibility(project, userId, wsMember);
  if (!vis) return null;
  const joinedAt = wsMember && !project.isInbox ? wsMember.createdAt : project.createdAt;
  return { projectId: project.id, userId, role: vis.role, joinedAt };
}

/** Owners проекта: inbox — всегда ровно 1 (владелец); иначе owners пространства. */
export function deriveOwnersCount(
  project: Pick<ProjectAccessRow, 'isInbox'>,
  wsOwnerCount: number,
): number {
  return project.isInbox ? 1 : wsOwnerCount;
}
