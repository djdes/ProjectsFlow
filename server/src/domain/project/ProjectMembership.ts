// Роль участника пространства, спроецированная на проект (см. workspaceMembershipView).
// 'lead' — руководитель (тимлид): те же права, что у владельца, плюс командные
// уведомления. Единственное, чего он не может, — менять роли участников (это гейтится
// не матрицей прав, а requireWorkspaceOwner). См.
// docs/superpowers/specs/2026-07-27-lead-role-design.md.
export type ProjectRole = 'owner' | 'lead' | 'editor' | 'viewer';

export const PROJECT_ROLES: readonly ProjectRole[] = ['owner', 'lead', 'editor', 'viewer'];

export type ProjectMembership = {
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
  readonly joinedAt: Date;
};
