export type GithubConnection = {
  readonly userId: string;
  readonly githubLogin: string;
  readonly githubUserId: string;
  readonly scopes: readonly string[];
  readonly connectedAt: Date;
};

// Внутренний тип — accessToken НЕ утекает за presentation.
export type GithubConnectionWithToken = GithubConnection & {
  readonly accessToken: string;
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
  readonly id: string;          // GitHub repo numeric id as string
  readonly fullName: string;    // "owner/repo"
  readonly htmlUrl: string;     // "https://github.com/owner/repo"
  readonly description: string | null;
  readonly private: boolean;
  readonly pushedAt: Date | null;
};
