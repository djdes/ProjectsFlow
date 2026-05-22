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

export type UserRepo = {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
};

// git-опция при создании проекта (см. pf_create_project).
export type CreateProjectGit =
  | { mode: 'none' }
  | { mode: 'connect'; gitRepoUrl: string }
  | { mode: 'create'; repoName?: string; description?: string; private?: boolean };

export type CreateProjectInput = {
  name: string;
  git?: CreateProjectGit;
};

export type UpdateProjectInput = {
  name?: string;
  gitRepoUrl?: string | null;
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

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done';

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
  commentCount?: number;
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

export type TaskComment = {
  id: string;
  taskId: string;
  ownerUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskWithAttachments = {
  task: Task;
  attachments: TaskAttachmentWithData[];
  comments: TaskComment[];
};

export type CreateCredentialField = {
  key: string;
  value: string;
  isSecret: boolean;
};

export type CreateCredentialInput = {
  title: string;
  kind?: string | null;
  slug?: string | null;
  fields: CreateCredentialField[];
};

export type CreateCredentialResult = {
  path: string;
  slug: string;
  sha: string;
  secretsWritten: string[];
};

export type CreateTaskInput = {
  description: string;
  status?: TaskStatus;
};

export type WriteKbDocInput = {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  sha: string | null;
};

export type WriteKbDocResult = {
  path: string;
  sha: string;
};

export type PendingAgentJob = {
  id: string;
  projectId: string;
  projectName: string;
  gitRepoUrl: string | null;
  taskId: string;
  taskDescription: string | null;
  createdAt: string;
};

export type AgentJobDto = {
  id: string;
  projectId: string;
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempt: number;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  prUrl: string | null;
  branchName: string | null;
  runnerPid: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CompleteAgentJobInput = {
  ok: boolean;
  prUrl?: string | null;
  error?: string | null;
  branchName?: string | null;
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

  async listUserRepos(): Promise<UserRepo[]> {
    const { repos } = await this.request<{ repos: UserRepo[] }>('/agent/repos');
    return repos;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const { project } = await this.request<{ project: Project }>('/agent/projects', {
      method: 'POST',
      body: input,
    });
    return project;
  }

  async updateProject(projectId: string, patch: UpdateProjectInput): Promise<Project> {
    const { project } = await this.request<{ project: Project }>(
      `/agent/projects/${encodeURIComponent(projectId)}`,
      { method: 'PATCH', body: patch },
    );
    return project;
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

  async createCredential(
    projectId: string,
    input: CreateCredentialInput,
  ): Promise<CreateCredentialResult> {
    const { credential } = await this.request<{ credential: CreateCredentialResult }>(
      `/agent/projects/${encodeURIComponent(projectId)}/credentials`,
      { method: 'POST', body: input },
    );
    return credential;
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const { task } = await this.request<{ task: Task }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks`,
      { method: 'POST', body: input },
    );
    return task;
  }

  async createTaskComment(
    projectId: string,
    taskId: string,
    body: string,
  ): Promise<TaskComment> {
    const { comment } = await this.request<{ comment: TaskComment }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`,
      { method: 'POST', body: { body } },
    );
    return comment;
  }

  async writeKbDocument(projectId: string, input: WriteKbDocInput): Promise<WriteKbDocResult> {
    return this.request<WriteKbDocResult>(
      `/agent/projects/${encodeURIComponent(projectId)}/kb/documents`,
      { method: 'POST', body: input },
    );
  }

  async listPendingAgentJobs(limit: number): Promise<PendingAgentJob[]> {
    const { jobs } = await this.request<{ jobs: PendingAgentJob[] }>(
      `/agent/pending-agent-jobs?limit=${limit}`,
    );
    return jobs;
  }

  async claimAgentJob(jobId: string): Promise<AgentJobDto> {
    const { job } = await this.request<{ job: AgentJobDto }>(
      `/agent/agent-jobs/${encodeURIComponent(jobId)}/claim`,
      { method: 'POST', body: {} },
    );
    return job;
  }

  async completeAgentJob(jobId: string, input: CompleteAgentJobInput): Promise<void> {
    await this.request<void>(
      `/agent/agent-jobs/${encodeURIComponent(jobId)}/complete`,
      { method: 'POST', body: input },
    );
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
