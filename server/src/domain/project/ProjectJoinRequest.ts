export type JoinRequestStatus = 'pending' | 'accepted' | 'declined';

// Заявка на вступление в проект по совпадению git-репозитория.
export type ProjectJoinRequest = {
  readonly id: string;
  readonly projectId: string;
  readonly requesterUserId: string;
  readonly gitRepoUrl: string;
  readonly status: JoinRequestStatus;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedByUserId: string | null;
};
