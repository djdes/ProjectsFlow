export type ProjectRole = 'owner' | 'editor' | 'viewer';

export const PROJECT_ROLES: readonly ProjectRole[] = ['owner', 'editor', 'viewer'];

export type ProjectMembership = {
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
  readonly joinedAt: Date;
};
