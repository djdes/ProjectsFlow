export type ProjectRole = 'owner' | 'editor' | 'viewer';

export const PROJECT_ROLES: readonly ProjectRole[] = ['owner', 'editor', 'viewer'];

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
