import type { AgentConfig } from './config.js';

// Тонкий API-клиент для ProjectsFlow agent-эндпоинтов.
// Bearer-токен прикрепляется автоматически.

export type Project = {
  id: string;
  name: string;
  status: string;
  hasKb: boolean;
  gitRepoUrl: string | null;
  // Ralph-диспетчер: какой юзер автономно выполняет задачи. null = ручной режим.
  dispatcherUserId?: string | null;
  // Удобный флаг: «этот проект назначен мне как Ralph-диспетчеру». Сервер заполняет
  // на всех agent-эндпоинтах, где знает токеновладельца.
  isMyDispatch?: boolean;
};

export type DispatchedProject = Project & {
  openTaskCount: number;
  queuedAgentJobCount: number;
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

// 'awaiting_clarification' — задача на паузе до действия человека (ответ на
// ralph-question, разбор retry-fail). Между in_progress и done в пайплайне.
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'awaiting_clarification'
  | 'done';

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
  // Тип актора (см. migration 034). 'user' — fallback для исторических записей.
  actorKind?: 'user' | 'agent' | 'system';
  agentName?: string | null;
  createdAt: string;
  updatedAt: string;
};

// Возвращается GET-эндпоинтом listTaskComments (для F11/диспетчера).
// ownerDisplayName может быть null если user удалён.
export type TaskCommentForAgent = {
  id: string;
  body: string;
  ownerUserId: string;
  ownerDisplayName: string | null;
  actorKind?: 'user' | 'agent' | 'system';
  agentName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListTaskCommentsFilters = {
  since?: string;
  limit?: number;
  has_marker?: 'ralph-question' | 'ralph-answer' | 'ralph-grillme-summary';
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

export type RepoUsageResult = {
  ownership: 'none' | 'self' | 'other';
  requestTarget: string | null;
};

export type RepoAccessRequestInput = {
  gitRepoUrl: string;
  requestTarget: string;
  message?: string;
};

export type RepoAccessResult = {
  status: 'pending' | 'already_requested' | 'approved' | 'denied';
  requestId: string | null;
};

export type ProjectMember = {
  userId: string;
  displayName: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer';
  isAdmin: boolean;
  joinedAt: string;
};

export type KbDocumentSummary = {
  path: string;
  title: string | null;
  kind: string | null;
  frontmatter: Record<string, unknown>;
  sha: string | null;
};

export type KbDocument = {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  sha: string | null;
};

export type TaskSearchResult = {
  taskId: string;
  projectId: string;
  projectName: string;
  status: TaskStatus;
  excerpt: string;
};

export type SyncCommitsResult = {
  linkedCount: number;
  autoTransitionedCount: number;
  scannedCount: number;
};

// Финансовая сводка. Сервер отдаёт суммы в копейках; обёртка добавляет рублёвые
// поля сводки (kopecks/100) для удобства агента, сохраняя копейки для точности.
export type FinanceLaborLine = {
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  monthlySalaryKopecks: number;
  allocationPercent: number;
  startedAt: string;
  endedAt: string | null;
  costKopecks: number;
};

export type FinanceExpense = {
  id: string;
  amountKopecks: number;
  category: string;
  description: string | null;
  incurredOn: string;
};

export type FinanceIncome = {
  id: string;
  amountKopecks: number;
  source: string | null;
  receivedOn: string;
};

export type ProjectFinance = {
  laborTotalKopecks: number;
  otherExpensesTotalKopecks: number;
  incomeTotalKopecks: number;
  expenseTotalKopecks: number;
  profitKopecks: number;
  marginPercent: number | null;
  labor: FinanceLaborLine[];
  expenses: FinanceExpense[];
  incomes: FinanceIncome[];
};

// Сводка с рублёвыми полями, добавленными обёрткой (см. getFinance).
export type ProjectFinanceWithRubles = ProjectFinance & {
  laborTotalRubles: number;
  otherExpensesTotalRubles: number;
  incomeTotalRubles: number;
  expenseTotalRubles: number;
  profitRubles: number;
};

export type AddExpenseInput = {
  amountRubles: number;
  category: string;
  description?: string;
  incurredOn?: string;
};

export type AddIncomeInput = {
  amountRubles: number;
  source?: string;
  receivedOn?: string;
};

export type ExpenseResult = {
  id: string;
  amountKopecks: number;
  category: string;
  description: string | null;
  incurredOn: string;
};

export type IncomeResult = {
  id: string;
  amountKopecks: number;
  source: string | null;
  receivedOn: string;
};

// Делегированный GitHub-токен для git-операций. v0.15: per-member opt-in.
// Сервер выбирает первого подходящего grantor'а в порядке owner→displayName ASC
// (caller-диспетчер исключается). source указывает «owner» это был или «member».
// Plaintext OAuth-токен — ТОЛЬКО для git-команд в репо проекта. Не персистить,
// не логировать. Сервер ротирует автоматически когда юзер перевыдаёт OAuth.
export type DelegatedGitToken = {
  token: string;
  login: string;
  scopes: string[];
  source: 'owner_delegation' | 'member_delegation';
  grantedBy: string;
  grantedByDisplayName: string;
  grantedAt: string;
};

// Полный «account dump» текущего юзера. Используется `pf_get_my_account`.
// Пароль — bcrypt-хэш, plaintext физически невозможно вернуть (поле
// passwordHashed: true как явное пояснение). Plaintext значения agent-токенов
// тоже невозможны (хранятся как хэш). GitHub OAuth access-token — твой
// собственный, возвращается plaintext'ом (симметрично pf_get_credential).
export type MyAccount = {
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    isAdmin: boolean;
    createdAt: string;
    passwordHashed: true;
  };
  github:
    | {
        connected: true;
        login: string;
        githubUserId: string;
        scopes: string[];
        connectedAt: string;
        accessToken: string;
      }
    | { connected: false };
  agentTokens: Array<{
    id: string;
    name: string;
    tokenPrefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    isCurrent: boolean;
    plaintextAvailable: false;
  }>;
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
      // ВАЖНО: без timeout зависший backend держит CallToolRequest-handler промис
      // вечно, и через несколько повторных вызовов MCP-процесс утекает по сокетам
      // и памяти (stdio long-running). 30s — щедро для всех нормальных тулов.
      signal: AbortSignal.timeout(30_000),
    };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchInit.body = JSON.stringify(init.body);
    }
    let res: Response;
    try {
      res = await fetch(`${this.config.apiUrl}${path}`, fetchInit);
    } catch (e) {
      if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') {
        throw new ApiError(599, `timeout after 30s on ${path}`, null);
      }
      throw e;
    }
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
    agentName?: string,
  ): Promise<TaskComment> {
    // agentName опционально — сервер дефолтит 'ralph-dispatcher'. Не отсылаем поле
    // если не задано, чтобы старые серверы (без 034) тоже работали.
    const payload: { body: string; agentName?: string } = { body };
    if (agentName) payload.agentName = agentName;
    const { comment } = await this.request<{ comment: TaskComment }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`,
      { method: 'POST', body: payload },
    );
    return comment;
  }

  async listTaskComments(
    projectId: string,
    taskId: string,
    filters: ListTaskCommentsFilters = {},
  ): Promise<TaskCommentForAgent[]> {
    const qs = new URLSearchParams();
    if (filters.since) qs.set('since', filters.since);
    if (filters.limit !== undefined) qs.set('limit', String(filters.limit));
    if (filters.has_marker) qs.set('has_marker', filters.has_marker);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const { comments } = await this.request<{ comments: TaskCommentForAgent[] }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments${suffix}`,
    );
    return comments;
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

  async checkRepoUsage(gitRepoUrl: string): Promise<RepoUsageResult> {
    return this.request<RepoUsageResult>(
      `/agent/repo-usage?gitRepoUrl=${encodeURIComponent(gitRepoUrl)}`,
    );
  }

  async requestRepoAccess(input: RepoAccessRequestInput): Promise<RepoAccessResult> {
    return this.request<RepoAccessResult>('/agent/repo-access-requests', {
      method: 'POST',
      body: input,
    });
  }

  async createLocalKb(projectId: string): Promise<void> {
    await this.request<void>(
      `/agent/projects/${encodeURIComponent(projectId)}/kb/init-local`,
      { method: 'POST', body: {} },
    );
  }

  async getProject(projectId: string): Promise<Project> {
    const { project } = await this.request<{ project: Project }>(
      `/agent/projects/${encodeURIComponent(projectId)}`,
    );
    return project;
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const { members } = await this.request<{ members: ProjectMember[] }>(
      `/agent/projects/${encodeURIComponent(projectId)}/members`,
    );
    return members;
  }

  async searchTasks(query: string): Promise<TaskSearchResult[]> {
    const { results } = await this.request<{ results: TaskSearchResult[] }>(
      `/agent/search/tasks?q=${encodeURIComponent(query)}`,
    );
    return results;
  }

  async listKbDocuments(projectId: string): Promise<KbDocumentSummary[]> {
    const { documents } = await this.request<{ documents: KbDocumentSummary[] }>(
      `/agent/projects/${encodeURIComponent(projectId)}/kb/documents`,
    );
    return documents;
  }

  async readKbDocument(projectId: string, path: string): Promise<KbDocument> {
    const { document } = await this.request<{ document: KbDocument }>(
      `/agent/projects/${encodeURIComponent(projectId)}/kb/document?path=${encodeURIComponent(path)}`,
    );
    return document;
  }

  async deleteKbDocument(projectId: string, path: string): Promise<void> {
    await this.request<void>(
      `/agent/projects/${encodeURIComponent(projectId)}/kb/document?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    );
  }

  async updateTask(projectId: string, taskId: string, description: string): Promise<Task> {
    const { task } = await this.request<{ task: Task }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: { description } },
    );
    return task;
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.request<void>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' },
    );
  }

  async listCommits(projectId: string, taskId: string): Promise<TaskCommit[]> {
    const { commits } = await this.request<{ commits: TaskCommit[] }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/commits`,
    );
    return commits;
  }

  async syncCommits(projectId: string): Promise<SyncCommitsResult> {
    return this.request<SyncCommitsResult>(
      `/agent/projects/${encodeURIComponent(projectId)}/sync-commits`,
      { method: 'POST', body: {} },
    );
  }

  async getFinance(projectId: string): Promise<ProjectFinanceWithRubles> {
    const { finance } = await this.request<{ finance: ProjectFinance }>(
      `/agent/projects/${encodeURIComponent(projectId)}/finance`,
    );
    // Обёртка добавляет рублёвые суммы сводки (копейки/100), сохраняя *Kopecks.
    return {
      ...finance,
      laborTotalRubles: finance.laborTotalKopecks / 100,
      otherExpensesTotalRubles: finance.otherExpensesTotalKopecks / 100,
      incomeTotalRubles: finance.incomeTotalKopecks / 100,
      expenseTotalRubles: finance.expenseTotalKopecks / 100,
      profitRubles: finance.profitKopecks / 100,
    };
  }

  async addExpense(projectId: string, input: AddExpenseInput): Promise<ExpenseResult> {
    const { expense } = await this.request<{ expense: ExpenseResult }>(
      `/agent/projects/${encodeURIComponent(projectId)}/finance/expenses`,
      { method: 'POST', body: input },
    );
    return expense;
  }

  async addIncome(projectId: string, input: AddIncomeInput): Promise<IncomeResult> {
    const { income } = await this.request<{ income: IncomeResult }>(
      `/agent/projects/${encodeURIComponent(projectId)}/finance/incomes`,
      { method: 'POST', body: input },
    );
    return income;
  }

  async getMyAccount(): Promise<MyAccount> {
    return this.request<MyAccount>('/agent/me');
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request<void>(
      `/agent/projects/${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    );
  }

  async listMyDispatchedProjects(): Promise<DispatchedProject[]> {
    const { projects } = await this.request<{ projects: DispatchedProject[] }>(
      '/agent/me/dispatched-projects',
    );
    return projects;
  }

  async setProjectDispatcher(projectId: string, userId: string | null): Promise<Project> {
    const { project } = await this.request<{ project: Project }>(
      `/agent/projects/${encodeURIComponent(projectId)}/dispatcher`,
      { method: 'PUT', body: { userId } },
    );
    return project;
  }

  async getProjectGitToken(projectId: string): Promise<DelegatedGitToken> {
    return this.request<DelegatedGitToken>(
      `/agent/projects/${encodeURIComponent(projectId)}/git-token`,
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
