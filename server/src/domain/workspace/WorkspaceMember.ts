export type WorkspaceRole = 'owner' | 'member';

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
