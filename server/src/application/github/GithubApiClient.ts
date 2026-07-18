import type { GithubCommit, GithubRepoSummary } from '../../domain/github/GithubConnection.js';

export type CreateRepoInput = {
  readonly name: string;
  readonly description?: string;
  readonly privateRepo: boolean;
  readonly autoInit: boolean;
};

export type CreateRepoResult = {
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly defaultBranch: string;
};

export type ImportRepoFile = {
  readonly path: string;
  readonly contentBase64: string;
};

export type RepoImportTarget = {
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly defaultBranch: string;
  readonly empty: boolean;
  readonly canPush: boolean;
};

export type RepoFileContent = {
  readonly path: string;
  readonly sha: string;
  readonly content: string;      // декодированный из base64
  readonly size: number;
};

export type RepoFileSummary = {
  readonly path: string;
  readonly sha: string;
  readonly type: 'file' | 'dir';
  readonly size: number;
};

export type RepoTreeResult = {
  readonly entries: readonly RepoFileSummary[];
  readonly truncated: boolean;
};

export type PutFileInput = {
  readonly accessToken: string;
  readonly owner: string;
  readonly repo: string;
  readonly path: string;
  readonly content: string;       // plain, мы encode'нем
  readonly message: string;
  readonly sha?: string;          // для update
};

export type DeviceCodeResponse = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number; // секунд от now
  readonly interval: number; // секунд между poll'ами
};

export type DevicePollResult =
  | { readonly kind: 'pending' }
  | { readonly kind: 'slow_down'; readonly newInterval: number }
  | { readonly kind: 'expired' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'success'; readonly accessToken: string; readonly scopes: readonly string[] };

export type GithubUserInfo = {
  readonly login: string;
  readonly id: string;
};

export type ListCommitsInput = {
  readonly owner: string;
  readonly repo: string;
  readonly limit: number;
};

export type GetCommitInput = {
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
};

export interface GithubApiClient {
  // OAuth Device Flow
  requestDeviceCode(): Promise<DeviceCodeResponse>;
  pollAccessToken(deviceCode: string): Promise<DevicePollResult>;

  // Authenticated calls
  getAuthenticatedUser(accessToken: string): Promise<GithubUserInfo>;
  listRecentCommits(accessToken: string, input: ListCommitsInput): Promise<GithubCommit[]>;
  getCommit(accessToken: string, input: GetCommitInput): Promise<GithubCommit>;
  // Все репозитории authenticated user (owner/member/collaborator), sort by pushed desc.
  listUserRepos(accessToken: string): Promise<GithubRepoSummary[]>;

  // Repo CRUD (for KB)
  createRepo(accessToken: string, input: CreateRepoInput): Promise<CreateRepoResult>;
  // Точная server-side проверка цели перед импортом. `empty` определяется по commits API,
  // а не по приблизительному `size` из списка репозиториев.
  getRepoImportTarget(accessToken: string, fullName: string): Promise<RepoImportTarget | null>;
  // Создаёт один корневой commit со всеми файлами импорта. В отличие от Contents API,
  // это не превращает каждый файл ZIP в отдельный commit и корректно сохраняет binary.
  importRepoFiles(
    accessToken: string,
    fullName: string,
    defaultBranch: string,
    files: readonly ImportRepoFile[],
    message: string,
    options?: { readonly requireEmpty?: boolean },
  ): Promise<void>;
  deleteRepo(accessToken: string, fullName: string): Promise<void>;
  repoExists(accessToken: string, fullName: string): Promise<boolean>;
  getRepoFile(accessToken: string, fullName: string, path: string): Promise<RepoFileContent | null>;
  listRepoTree(accessToken: string, fullName: string, path?: string): Promise<RepoFileSummary[]>;
  listRepoTreeRecursive(accessToken: string, fullName: string): Promise<RepoTreeResult>;
  putRepoFile(input: PutFileInput): Promise<{ sha: string }>;
  deleteRepoFile(accessToken: string, fullName: string, path: string, sha: string, message: string): Promise<void>;
}
