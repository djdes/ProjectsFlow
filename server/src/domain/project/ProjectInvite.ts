// Роли которые можно выдавать через invite. Owner НЕ через invite — передаётся
// отдельным endpoint'ом ownership-transfer (см. spec секцию 5).
export type ProjectInviteRole = 'editor' | 'viewer';

export type ProjectInvite = {
  readonly id: string;
  readonly projectId: string;
  readonly role: ProjectInviteRole;
  // 32-byte hex (64 char'а). Не отдаём наружу проекту с информацией о приглашении —
  // только в момент создания и владельцу.
  readonly token: string;
  readonly email: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedByUserId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: Date;
};
