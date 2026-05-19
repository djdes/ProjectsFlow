export type ProjectInviteRole = 'editor' | 'viewer';

export type ProjectInvite = {
  readonly id: string;
  readonly projectId: string;
  readonly role: ProjectInviteRole;
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

// Preview-данные для /invite/:token (anon-страница).
export type ProjectInvitePreview = {
  readonly projectName: string;
  readonly role: ProjectInviteRole;
  readonly inviterDisplayName: string | null;
  readonly inviteEmail: string | null;
  readonly expiresAt: Date;
};
