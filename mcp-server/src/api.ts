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

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
  commitCount?: number;
};

export type TaskCommit = {
  taskId: string;
  sha: string;
  message: string;
  authorName: string;
  authorAvatarUrl: string | null;
  htmlUrl: string;
  committedAt: string;
  linkedAt: string;
};

export type TaskAttachmentWithData = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  dataBase64: string;
};

export type TaskWithAttachments = {
  task: Task;
  attachments: TaskAttachmentWithData[];
};

export class ApiClient {
  constructor(private readonly config: AgentConfig) {}

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/json',
    };
    const fetchInit: RequestInit = {
      method: init?.method ?? 'GET',
      headers,
    };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchInit.body = JSON.stringify(init.body);
    }
    const res = await fetch(`${this.config.apiUrl}${path}`, fetchInit);
    if (!res.ok) {
      let detail: unknown = null;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => null);
      }
      throw new ApiError(res.status, `HTTP ${res.status} from ${path}`, detail);
    }
    // 204 — пустой ответ.
    if (res.status === 204) return undefined as T;
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

  async listTasks(projectId: string): Promise<Task[]> {
    const { tasks } = await this.request<{ tasks: Task[] }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks`,
    );
    return tasks;
  }

  async getTask(projectId: string, taskId: string): Promise<TaskWithAttachments> {
    return this.request<TaskWithAttachments>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    );
  }

  async moveTask(
    projectId: string,
    taskId: string,
    targetStatus: TaskStatus,
  ): Promise<Task> {
    const { task } = await this.request<{ task: Task }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/move`,
      { method: 'POST', body: { targetStatus } },
    );
    return task;
  }

  async linkCommitToTask(
    projectId: string,
    taskId: string,
    sha: string,
  ): Promise<TaskCommit> {
    const { commit } = await this.request<{ commit: TaskCommit }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/commits`,
      { method: 'POST', body: { sha } },
    );
    return commit;
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
