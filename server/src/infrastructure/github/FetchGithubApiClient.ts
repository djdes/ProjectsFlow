import type { GithubCommit, GithubRepoSummary } from '../../domain/github/GithubConnection.js';
import { GithubApiError, GithubIntegrationDisabledError } from '../../domain/github/errors.js';
import type {
  CreateRepoInput,
  CreateRepoResult,
  DeviceCodeResponse,
  DevicePollResult,
  GetCommitInput,
  GithubApiClient,
  GithubUserInfo,
  ListCommitsInput,
  PutFileInput,
  RepoFileContent,
  RepoFileSummary,
} from '../../application/github/GithubApiClient.js';

// `repo` scope покрывает чтение/запись private + public репо — нужен для создания
// private KB-репо. Включает в себя public_repo, отдельно его указывать не надо.
// `workflow` нужен, чтобы класть/править файлы под `.github/workflows/` (build-workflow
// app-репо, self-serve воркер-раннер) — обычный `repo` в workflow-файлы GitHub не пускает.
const SCOPES = 'read:user repo workflow';

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
    // GitHub отдаёт 409 "Git Repository is empty" для свежесозданных репо без коммитов.
    // Это валидное состояние, не ошибка — возвращаем пустой массив.
    if (res.status === 409) return [];
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

  async getCommit(accessToken: string, input: GetCommitInput): Promise<GithubCommit> {
    const url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits/${encodeURIComponent(input.sha)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) throw new GithubApiError(res.status, `get commit failed: ${await res.text()}`);
    const c = (await res.json()) as CommitRawResponse;
    return {
      sha: c.sha,
      message: c.commit.message,
      authorName: c.commit.author.name,
      authorAvatarUrl: c.author?.avatar_url ?? null,
      committedAt: new Date(c.commit.author.date),
      htmlUrl: c.html_url,
    };
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

  async createRepo(accessToken: string, input: CreateRepoInput): Promise<CreateRepoResult> {
    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        private: input.privateRepo,
        auto_init: input.autoInit,
      }),
    });
    if (!res.ok) throw new GithubApiError(res.status, `createRepo failed: ${await res.text()}`);
    const data = (await res.json()) as { full_name: string; html_url: string };
    return { fullName: data.full_name, htmlUrl: data.html_url };
  }

  async repoExists(accessToken: string, fullName: string): Promise<boolean> {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    return res.status === 200;
  }

  async getRepoFile(accessToken: string, fullName: string, path: string): Promise<RepoFileContent | null> {
    const res = await fetch(`https://api.github.com/repos/${fullName}/contents/${encodeURI(path)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new GithubApiError(res.status, `getRepoFile failed: ${await res.text()}`);
    const data = (await res.json()) as { path: string; sha: string; size: number; content: string; encoding: string };
    if (data.encoding !== 'base64') throw new GithubApiError(500, `unexpected encoding ${data.encoding}`);
    return {
      path: data.path,
      sha: data.sha,
      size: data.size,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
    };
  }

  async listRepoTree(accessToken: string, fullName: string, path = ''): Promise<RepoFileSummary[]> {
    const url = path
      ? `https://api.github.com/repos/${fullName}/contents/${encodeURI(path)}`
      : `https://api.github.com/repos/${fullName}/contents`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new GithubApiError(res.status, `listRepoTree failed: ${await res.text()}`);
    const data = (await res.json()) as Array<{ path: string; sha: string; type: string; size: number }>;
    return data.map((d) => ({
      path: d.path,
      sha: d.sha,
      type: d.type === 'dir' ? 'dir' : 'file',
      size: d.size,
    }));
  }

  async putRepoFile(input: PutFileInput): Promise<{ sha: string }> {
    const body: Record<string, unknown> = {
      message: input.message,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
    };
    if (input.sha) body.sha = input.sha;
    const url = `https://api.github.com/repos/${input.owner}/${input.repo}/contents/${encodeURI(input.path)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 409) throw new GithubApiError(409, 'sha conflict');
    if (!res.ok) throw new GithubApiError(res.status, `putRepoFile failed: ${await res.text()}`);
    const data = (await res.json()) as { content: { sha: string } };
    return { sha: data.content.sha };
  }

  async deleteRepoFile(accessToken: string, fullName: string, path: string, sha: string, message: string): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${fullName}/contents/${encodeURI(path)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, sha }),
    });
    if (!res.ok) throw new GithubApiError(res.status, `deleteRepoFile failed: ${await res.text()}`);
  }
}
