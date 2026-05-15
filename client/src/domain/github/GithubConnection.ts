export type GithubConnection = {
  readonly githubLogin: string;
  readonly githubUserId: string;
  readonly scopes: readonly string[];
  readonly connectedAt: Date;
};

export type GithubCommit = {
  readonly sha: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly committedAt: Date;
  readonly htmlUrl: string;
};

export type GithubRepoSummary = {
  readonly id: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly private: boolean;
  readonly pushedAt: Date | null;
};
