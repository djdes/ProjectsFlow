import type { AgentConfig } from './config.js';

// Тонкий API-клиент для ProjectsFlow agent-эндпоинтов.
// Bearer-токен прикрепляется автоматически.

export type Project = {
  id: string;
  name: string;
  status: string;
  hasKb: boolean;
  gitRepoUrl: string | null;
};

export type CredentialSummary = {
  slug: string;
  path: string;
  title: string | null;
  kind: string | null;
};

export type ResolvedCredential = {
  title: string;
  kind: string | null;
  fields: Record<string, string>;
};

export class ApiClient {
  constructor(private readonly config: AgentConfig) {}

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.config.apiUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      let detail: unknown = null;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => null);
      }
      throw new ApiError(res.status, `HTTP ${res.status} from ${path}`, detail);
    }
    return res.json() as Promise<T>;
  }

  async listProjects(): Promise<Project[]> {
    const { projects } = await this.request<{ projects: Project[] }>('/agent/projects');
    return projects;
  }

  async listCredentials(projectId: string): Promise<CredentialSummary[]> {
    const { credentials } = await this.request<{ credentials: CredentialSummary[] }>(
      `/agent/projects/${encodeURIComponent(projectId)}/credentials`,
    );
    return credentials;
  }

  async getCredential(projectId: string, slug: string): Promise<ResolvedCredential> {
    const { credential } = await this.request<{ credential: ResolvedCredential }>(
      `/agent/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(slug)}`,
    );
    return credential;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
