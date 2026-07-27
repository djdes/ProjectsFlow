// 'lead' — руководитель (тимлид): те же права, что у владельца, плюс командные
// уведомления. Роль выдаёт владелец пространства.
export type ProjectRole = 'owner' | 'lead' | 'editor' | 'viewer';

export const PROJECT_ROLES: readonly ProjectRole[] = ['owner', 'lead', 'editor', 'viewer'];

// Владельческие права: всё, что раньше проверялось как role === 'owner'. Смена ролей
// участников остаётся за владельцем пространства и гейтится отдельно (isWorkspaceOwner).
export function hasOwnerRights(role: ProjectRole | undefined | null): boolean {
  return role === 'owner' || role === 'lead';
}

export type ProjectMember = {
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
  readonly joinedAt: Date;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  };
};
