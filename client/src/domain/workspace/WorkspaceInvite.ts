// Приглашение в пространство (workspace_invites, зеркало бывших project_invites).
// Mirrors server/src/domain/workspace/WorkspaceInvite.ts.

export type WorkspaceInviteRole = 'editor' | 'viewer';
export type InviteDeliveryStatus = 'queued' | 'sent' | 'failed' | 'not_registered' | 'not_connected' | 'unavailable';

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
  readonly excludedProjectIds?: readonly string[];
  readonly delivery?: Partial<Record<'email' | 'site' | 'telegram', InviteDeliveryStatus>> | null;
  readonly deliveryNextAttemptAt?: Date | null;
  readonly lastSentAt?: Date | null;
  readonly reused?: boolean;
  // token и url есть только в ответе на create, в листинге их нет.
  readonly token?: string;
  readonly url?: string;
};
