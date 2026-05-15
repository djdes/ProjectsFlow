import type { GithubCommit, GithubConnection, GithubRepoSummary } from '@/domain/github/GithubConnection';

export type DeviceFlowStart = {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: Date;
  readonly intervalSec: number;
};

export type DevicePollResult =
  | { readonly status: 'pending'; readonly slowDownSec?: number }
  | { readonly status: 'expired' }
  | { readonly status: 'connected'; readonly connection: GithubConnection };

export interface GithubRepository {
  getConnection(): Promise<GithubConnection | null>;
  startDeviceFlow(): Promise<DeviceFlowStart>;
  pollDeviceFlow(): Promise<DevicePollResult>;
  disconnect(): Promise<void>;
  listProjectCommits(projectId: string): Promise<GithubCommit[]>;
  listUserRepos(): Promise<GithubRepoSummary[]>;
}
