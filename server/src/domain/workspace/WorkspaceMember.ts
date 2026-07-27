// Роль в пространстве. Совпадает 1:1 с ProjectRole (см. workspaceMembershipView):
// 'lead' — руководитель, права владельца плюс командные уведомления.
export type WorkspaceRole = 'owner' | 'lead' | 'editor' | 'viewer';

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['owner', 'lead', 'editor', 'viewer'];

// Участник пространства. displayName/email/avatarUrl заполняются только для member-list
// ответов (join с users); в guard-проверках достаточно workspaceId/userId/role.
export type WorkspaceMember = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly displayName?: string;
  readonly email?: string;
  readonly avatarUrl?: string | null;
};
