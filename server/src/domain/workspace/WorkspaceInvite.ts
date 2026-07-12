// Роли, которые можно выдавать через workspace-invite. Owner НЕ через invite —
// владение пространством передаётся отдельно (управление командой пространства).
export type WorkspaceInviteRole = 'editor' | 'viewer';

export type WorkspaceInvite = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: WorkspaceInviteRole;
  // 32-byte hex (64 char'а). Наружу отдаётся только в момент создания и владельцу.
  readonly token: string;
  readonly email: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedByUserId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: Date;
};
