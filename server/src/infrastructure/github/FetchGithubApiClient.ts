import type { GithubCommit, GithubRepoSummary } from '../../domain/github/GithubConnection.js';
import { GithubApiError, GithubIntegrationDisabledError } from '../../domain/github/errors.js';
import type {
  DeviceCodeResponse,
  DevicePollResult,
  GithubApiClient,
  GithubUserInfo,
  ListCommitsInput,
} from '../../application/github/GithubApiClient.js';

const SCOPES = 'read:user public_repo';

type DeviceCodeRawResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type AccessTokenRawResponse =
  | { access_token: string; scope: string; token_type: string }
  | { error: string; error_description?: string; interval?: number };

type UserRawResponse = {
  login: string;
  id: number;
};

type CommitRawResponse = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { avatar_url: string } | null;
};

export class FetchGithubApiClient implements GithubApiClient {
  constructor(private readonly clientId: string | null) {}

  private ensureConfigured(): string {
    if (!this.clientId) throw new GithubIntegrationDisabledError();
    return this.clientId;
  }

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const clientId = this.ensureConfigured();
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: SCOPES }),
    });
    if (!res.ok) {
      throw new GithubApiError(res.status, `device/code failed: ${await res.text()}`);
    }
    const data = (await res.json()) as DeviceCodeRawResponse;
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  async pollAccessToken(deviceCode: string): Promise<DevicePollResult> {
    const clientId = this.ensureConfigured();
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    if (!res.ok) {
      throw new GithubApiError(res.status, `poll failed: ${await res.text()}`);
    }
    const data = (await res.json()) as AccessTokenRawResponse;

    if ('access_token' in data) {
      const scopes = data.scope.split(',').map((s) => s.trim()).filter(Boolean);
      return { kind: 'success', accessToken: data.access_token, scopes };
    }

    switch (data.error) {
      case 'authorization_pending':
        return { kind: 'pending' };
      case 'slow_down':
        return { kind: 'slow_down', newInterval: data.interval ?? 10 };
      case 'expired_token':
        return { kind: 'expired' };
      case 'access_denied':
        return { kind: 'denied' };
      default:
        throw new GithubApiError(res.status, `unknown error: ${data.error}`);
    }
  }

  async getAuthenticatedUser(accessToken: string): Promise<GithubUserInfo> {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) throw new GithubApiError(res.status, `/user failed: ${await res.text()}`);
    const data = (await res.json()) as UserRawResponse;
    return { login: data.login, id: String(data.id) };
  }

  async listRecentCommits(accessToken: string, input: ListCommitsInput): Promise<GithubCommit[]> {
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits`);
    url.searchParams.set('per_page', String(input.limit));
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) throw new GithubApiError(res.status, `commits failed: ${await res.text()}`);
    const data = (await res.json()) as CommitRawResponse[];
    return data.map(
      (c): GithubCommit => ({
        sha: c.sha,
        message: c.commit.message,
        authorName: c.commit.author.name,
        authorAvatarUrl: c.author?.avatar_url ?? null,
        committedAt: new Date(c.commit.author.date),
        htmlUrl: c.html_url,
      }),
    );
  }

  async listUserRepos(accessToken: string): Promise<GithubRepoSummary[]> {
    // Сортируем по pushed desc — недавно активные сверху.
    // per_page=100 — потолок без пагинации. Если у юзера >100 репо — добавим page-loop позже.
    const url = 'https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member';
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) throw new GithubApiError(res.status, `repos failed: ${await res.text()}`);
    const data = (await res.json()) as Array<{
      id: number;
      full_name: string;
      html_url: string;
      description: string | null;
      private: boolean;
      pushed_at: string | null;
    }>;
    return data.map(
      (r): GithubRepoSummary => ({
        id: String(r.id),
        fullName: r.full_name,
        htmlUrl: r.html_url,
        description: r.description,
        private: r.private,
        pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
      }),
    );
  }
}
