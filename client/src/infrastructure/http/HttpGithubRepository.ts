import type {
  GithubCommit,
  GithubConnection,
  GithubRepoSummary,
} from '@/domain/github/GithubConnection';
import type {
  DeviceFlowStart,
  DevicePollResult,
  GithubRepository,
} from '@/application/github/GithubRepository';
import { httpClient } from './httpClient';

type ConnectionDto = {
  githubLogin: string;
  githubUserId: string;
  scopes: string[];
  connectedAt: string;
};

function fromConnectionDto(dto: ConnectionDto): GithubConnection {
  return {
    githubLogin: dto.githubLogin,
    githubUserId: dto.githubUserId,
    scopes: dto.scopes,
    connectedAt: new Date(dto.connectedAt),
  };
}

type CommitDto = {
  sha: string;
  message: string;
  authorName: string;
  authorAvatarUrl: string | null;
  committedAt: string;
  htmlUrl: string;
};

function fromCommitDto(dto: CommitDto): GithubCommit {
  return {
    sha: dto.sha,
    message: dto.message,
    authorName: dto.authorName,
    authorAvatarUrl: dto.authorAvatarUrl,
    committedAt: new Date(dto.committedAt),
    htmlUrl: dto.htmlUrl,
  };
}

export class HttpGithubRepository implements GithubRepository {
  async getConnection(): Promise<GithubConnection | null> {
    const { connection } = await httpClient.get<{ connection: ConnectionDto | null }>(
      '/integrations/github/me',
    );
    return connection ? fromConnectionDto(connection) : null;
  }

  async startDeviceFlow(): Promise<DeviceFlowStart> {
    const res = await httpClient.post<{
      userCode: string;
      verificationUri: string;
      expiresAt: string;
      intervalSec: number;
    }>('/integrations/github/connect/start');
    return {
      userCode: res.userCode,
      verificationUri: res.verificationUri,
      expiresAt: new Date(res.expiresAt),
      intervalSec: res.intervalSec,
    };
  }

  async pollDeviceFlow(): Promise<DevicePollResult> {
    const res = await httpClient.post<
      | { status: 'pending'; slowDownSec?: number }
      | { status: 'expired' }
      | { status: 'connected'; connection: ConnectionDto }
    >('/integrations/github/connect/poll');
    if (res.status === 'connected') {
      return { status: 'connected', connection: fromConnectionDto(res.connection) };
    }
    return res;
  }

  async disconnect(): Promise<void> {
    await httpClient.delete<void>('/integrations/github');
  }

  async listProjectCommits(projectId: string): Promise<GithubCommit[]> {
    const { commits } = await httpClient.get<{ commits: CommitDto[] }>(
      `/projects/${projectId}/commits`,
    );
    return commits.map(fromCommitDto);
  }

  async listUserRepos(): Promise<GithubRepoSummary[]> {
    const { repos } = await httpClient.get<{ repos: RepoSummaryDto[] }>(
      '/integrations/github/repos',
    );
    return repos.map(fromRepoDto);
  }
}

type RepoSummaryDto = {
  id: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
};

function fromRepoDto(dto: RepoSummaryDto): GithubRepoSummary {
  return {
    id: dto.id,
    fullName: dto.fullName,
    htmlUrl: dto.htmlUrl,
    description: dto.description,
    private: dto.private,
    pushedAt: dto.pushedAt ? new Date(dto.pushedAt) : null,
  };
}
