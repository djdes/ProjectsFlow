import type { GithubCommit, GithubRepoSummary } from '../../domain/github/GithubConnection.js';

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

export interface GithubApiClient {
  // OAuth Device Flow
  requestDeviceCode(): Promise<DeviceCodeResponse>;
  pollAccessToken(deviceCode: string): Promise<DevicePollResult>;

  // Authenticated calls
  getAuthenticatedUser(accessToken: string): Promise<GithubUserInfo>;
  listRecentCommits(accessToken: string, input: ListCommitsInput): Promise<GithubCommit[]>;
  // Все репозитории authenticated user (owner/member/collaborator), sort by pushed desc.
  listUserRepos(accessToken: string): Promise<GithubRepoSummary[]>;
}
