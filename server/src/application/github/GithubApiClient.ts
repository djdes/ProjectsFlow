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
  repoExists(accessToken: string, fullName: string): Promise<boolean>;
  getRepoFile(accessToken: string, fullName: string, path: string): Promise<RepoFileContent | null>;
  listRepoTree(accessToken: string, fullName: string, path?: string): Promise<RepoFileSummary[]>;
  putRepoFile(input: PutFileInput): Promise<{ sha: string }>;
  deleteRepoFile(accessToken: string, fullName: string, path: string, sha: string, message: string): Promise<void>;
}
