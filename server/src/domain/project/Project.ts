export type ProjectStatus = 'active' | 'paused' | 'archived';

export type Project = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly kbRepoFullName: string | null;
  readonly createdAt: Date;
};
