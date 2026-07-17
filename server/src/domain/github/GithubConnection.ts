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
  // Login is needed to map a commit author back to a workspace participant and
  // mention that participant in the Telegram review. It is null for commits
  // whose author is not linked to a GitHub account (for example, imported git history).
  readonly authorLogin?: string | null;
  readonly authorAvatarUrl: string | null;
  readonly committedAt: Date;
  readonly htmlUrl: string;
  readonly additions?: number | null;
  readonly deletions?: number | null;
  readonly changedFiles?: number | null;
  readonly files?: readonly {
    readonly path: string;
    readonly status: string;
    readonly additions: number;
    readonly deletions: number;
    readonly patch: string | null;
  }[];
};

export type GithubRepoSummary = {
  readonly id: string;          // GitHub repo numeric id as string
  readonly fullName: string;    // "owner/repo"
  readonly htmlUrl: string;     // "https://github.com/owner/repo"
  readonly description: string | null;
  readonly private: boolean;
  readonly pushedAt: Date | null;
};
