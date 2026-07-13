// Приглашение в пространство (workspace_invites, зеркало бывших project_invites).
// Mirrors server/src/domain/workspace/WorkspaceInvite.ts.

export type WorkspaceInviteRole = 'editor' | 'viewer';

export type WorkspaceInvite = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: WorkspaceInviteRole;
  // Информационный email (кому отправлено письмо). null = «бесхозная» ссылка.
  readonly email: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedByUserId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: Date;
  // token и url есть только в ответе на create, в листинге их нет.
  readonly token?: string;
  readonly url?: string;
};
