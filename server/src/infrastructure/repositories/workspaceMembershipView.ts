// Чистая логика «членство проекта через пространство» (спека unified-workspace §3.2).
// Вынесена из DrizzleProjectMemberRepository, чтобы инвариант приватности Входящих
// был покрыт unit-тестами без реальной БД.
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import { capGuestRole } from '../../domain/project/permissions.js';

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
 * его убрали из пространства). Не-inbox виден участнику пространства с его ws-ролью 1:1,
 * НО создатель проекта (projects.owner_id) — 'owner' СВОЕГО проекта поверх ws-роли: после
 * workspace-merge пространство может принадлежать другому, а создатель всё равно вправе
 * удалить/настроить свой проект (delete_project и прочая danger zone, см. permissions.ts).
 * Ответственные видят отдельные inbox-задачи через taskAuthorization, но НЕ через членство.
 */
export function projectRowVisibility(
  project: Pick<ProjectAccessRow, 'isInbox' | 'ownerId'>,
  userId: string,
  wsMember: Pick<WorkspaceMemberAccessRow, 'role'> | null,
  excluded = false,
): { readonly role: ProjectRole } | null {
  if (project.isInbox) {
    return project.ownerId === userId ? { role: 'owner' } : null;
  }
  if (!wsMember) return null;
  if (excluded && wsMember.role !== 'owner' && wsMember.role !== 'lead') return null;
  // Создатель = owner своего проекта поверх ws-роли (editor). Даёт danger zone создателю.
  if (project.ownerId === userId) return { role: 'owner' };
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
  excluded = false,
): ProjectMembership | null {
  const vis = projectRowVisibility(project, userId, wsMember, excluded);
  if (!vis) return null;
  const joinedAt = wsMember && !project.isInbox ? wsMember.createdAt : project.createdAt;
  return { projectId: project.id, userId, role: vis.role, joinedAt };
}

// Членство юзера в одном из пространств проекта (основном или подключённом, db/182).
export type ProjectWorkspaceAccessRow = WorkspaceMemberAccessRow & {
  readonly workspaceId: string;
  // Проект скрыт от юзера галочкой в этом пространстве.
  readonly excluded: boolean;
};

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, lead: 3, owner: 4 };

/**
 * Членство в проекте с учётом подключённых пространств (db/182). `rows` — членства юзера в
 * пространствах проекта (основное + подключённые).
 *
 *  - Членство в основном пространстве решает всё, как и без подключений: его роль
 *    (создатель — owner), а скрытие галочкой там закрывает проект целиком — подключённое
 *    пространство его не обходит.
 *  - Иначе юзер — гость (`guest: true`) через подключённое пространство: лучшая из его ролей
 *    там, но не выше editor, и только работа с задачами (canMember). Скрытие галочкой в
 *    подключённом пространстве закрывает этот путь.
 */
export function deriveSharedMembership(
  project: ProjectAccessRow,
  userId: string,
  rows: readonly ProjectWorkspaceAccessRow[],
): ProjectMembership | null {
  if (project.isInbox) return deriveMembership(project, userId, null);
  const home = rows.find((row) => row.workspaceId === project.workspaceId);
  if (home) {
    const membership = deriveMembership(project, userId, home, home.excluded);
    // Скрыт в основном пространстве — скрыт везде.
    return membership;
  }
  let best: ProjectWorkspaceAccessRow | null = null;
  for (const row of rows) {
    if (row.excluded && row.role !== 'owner' && row.role !== 'lead') continue;
    if (!best || ROLE_RANK[capGuestRole(row.role)] > ROLE_RANK[capGuestRole(best.role)]) best = row;
  }
  if (!best) return null;
  return { projectId: project.id, userId, role: capGuestRole(best.role), joinedAt: best.createdAt, guest: true };
}

/** Owners проекта: inbox — всегда ровно 1 (владелец); иначе owners пространства. */
export function deriveOwnersCount(
  project: Pick<ProjectAccessRow, 'isInbox'>,
  wsOwnerCount: number,
): number {
  return project.isInbox ? 1 : wsOwnerCount;
}
