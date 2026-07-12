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
 * Членство юзера в проекте, дериватив от членства в пространстве.
 * Инвариант приватности Входящих: is_inbox → доступ есть ТОЛЬКО у владельца
 * (projects.owner_id), роль всегда 'owner'. Делегаты видят отдельные inbox-задачи
 * через taskAuthorization, но НЕ через членство в проекте.
 */
export function deriveMembership(
  project: ProjectAccessRow,
  userId: string,
  wsMember: WorkspaceMemberAccessRow | null,
): ProjectMembership | null {
  if (project.isInbox) {
    if (project.ownerId !== userId) return null;
    return { projectId: project.id, userId, role: 'owner', joinedAt: project.createdAt };
  }
  if (!wsMember) return null;
  return {
    projectId: project.id,
    userId,
    role: wsMember.role,
    joinedAt: wsMember.createdAt,
  };
}

/** Список участников проекта: для inbox — только владелец; иначе все участники пространства. */
export function deriveProjectMembers(
  project: ProjectAccessRow,
  wsMembers: readonly WorkspaceMemberAccessRow[],
): ProjectMembership[] {
  if (project.isInbox) {
    const owner = wsMembers.find((m) => m.userId === project.ownerId);
    return [
      {
        projectId: project.id,
        userId: project.ownerId,
        role: 'owner',
        joinedAt: owner?.createdAt ?? project.createdAt,
      },
    ];
  }
  return wsMembers.map((m) => ({
    projectId: project.id,
    userId: m.userId,
    role: m.role,
    joinedAt: m.createdAt,
  }));
}

/** Owners проекта: inbox — всегда ровно 1 (владелец); иначе owners пространства. */
export function deriveOwnersCount(
  project: Pick<ProjectAccessRow, 'isInbox'>,
  wsOwnerCount: number,
): number {
  return project.isInbox ? 1 : wsOwnerCount;
}
