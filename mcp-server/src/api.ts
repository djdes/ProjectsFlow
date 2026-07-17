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
  // Включена ли автоматизация проекта (см. план virtual-exploring-pascal.md).
  automationEnabled?: boolean;
};

// Конфиг автоматизации для диспетчера: следующий критерий с промптом + надо ли продолжать.
export type AutomationDispatcherCriterion = {
  key: string;
  label: string;
  systemPrompt: string;
  userHint: string | null;
};

export type AutomationForDispatcher = {
  enabled: boolean;
  shouldRun: boolean;
  limitKind: 'count' | 'time';
  limitCount: number | null;
  limitMinutes: number | null;
  tasksCreated: number;
  runStartedAt: string | null;
  runStatus: 'idle' | 'running' | 'completed' | 'stopped';
  pauseMinSeconds: number;
  pauseMaxSeconds: number;
  ralphMode: string;
  // Публикация/деплой (db/061): воркер применяет к коммиту/пушу/деплою.
  gitAuthorMode: 'bot' | 'owner' | 'custom';
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  ignoreClaudeMd: boolean;
  ultracodeReviewEnabled: boolean;
  deployMethod: 'github_auto' | 'ssh_manual' | 'none' | 'auto';
  deployCommand: string | null;
  nextCriterion: AutomationDispatcherCriterion | null;
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
// 'manual' — отдельная ветка вне pipeline'а: колонка для задач, которые делает
// человек руками. Авто-переходов и agent-job триггеров не имеет.
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'awaiting_clarification'
  | 'done'
  | 'manual';

// Режим работы Ralph по задаче. См. spec C:/www/ralph/prompts/task-ralph-mode.md.
//   'normal'  — дефолт; worker может задать ralph-question, grillme по триггерам.
//   'silent'  — worker не задаёт вопросов; при неясности сразу blocked.
//   'grillme' — принудительно запускается grillme (до 10 вопросов), затем worker как normal.
export type RalphMode = 'normal' | 'silent' | 'grillme';

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  // Optional на проводе — старый backend без миграции 035 не присылает.
  ralphMode?: RalphMode;
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
  ralphMode?: RalphMode;
};

export type UpdateTaskInput = {
  description?: string;
  ralphMode?: RalphMode;
  // Приоритет 1..4 (1=urgent, 4=low). null очищает. undefined — не менять.
  priority?: number | null;
  // Дедлайн 'YYYY-MM-DD'. null очищает. undefined — не менять.
  deadline?: string | null;
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

// AI prompt-improvement jobs (see docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md)
export type PendingAiPromptJob = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
};

export type AiPromptJobClaimed = {
  id: string;
  projectId: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  // 'improve' (legacy) | 'compose' (2 варианта + разбивка по проектам).
  mode?: 'improve' | 'compose';
  // Текст от юзера (1..5000 символов).
  inputText: string;
  // Опциональный KB-контекст, пре-собранный сервером.
  kbContext: string | null;
  claimedAt: string | null;
  createdAt: string;
};

export type CompleteAiPromptJobInput = {
  ok: boolean;
  improvedText?: string | null;
  error?: string | null;
};

// AI-анализ мониторинга через диспетчера (db/063).
export type MonitoringAnalysisKind = 'snapshot' | 'logs' | 'alert' | 'digest';

export type PendingMonitoringAnalysisJob = {
  id: string;
  projectId: string;
  projectName: string | null;
  serverId: string;
  serverName: string | null;
  analysisType: MonitoringAnalysisKind;
  createdAt: string;
};

export type MonitoringAnalysisJobClaimed = {
  id: string;
  projectId: string;
  serverId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  analysisType: MonitoringAnalysisKind;
  alertId: string | null;
  note: string | null;
  // Пред-собранный markdown-контекст: снимок/логи/алерты/тренд. Анализируй его — ничего не до-запрашивай.
  context: string | null;
  claimedAt: string | null;
  createdAt: string;
};

export type CompleteMonitoringAnalysisJobInput = {
  ok: boolean;
  resultMarkdown?: string | null;
  error?: string | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
};

// Ежедневная commit-sync (db/072): сопоставление коммитов с задачами по смыслу.
export type PendingCommitSyncJob = {
  id: string;
  projectId: string;
  projectName: string | null;
  createdAt: string;
};

export type CommitSyncJobClaimed = {
  id: string;
  projectId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  // Порог часов — справочно (применяет сервер; тебе решать статус НЕ нужно).
  thresholdHours: number;
  // Пред-собранный markdown-контекст: задачи + коммиты с ageHours + порог + схема ответа.
  context: string | null;
  claimedAt: string | null;
  createdAt: string;
};

export type CommitSyncMatchInput = {
  taskId: string;
  commitSha: string;
  reason?: string | null;
};

export type CommitSyncReviewInput = {
  commitSha: string;
  verdict: 'good' | 'attention';
  summary: string;
};

export type CompleteCommitSyncJobInput = {
  ok: boolean;
  matches?: CommitSyncMatchInput[] | null;
  reviews?: CommitSyncReviewInput[] | null;
  overallSummary?: string | null;
  error?: string | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
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
// тоже невозможны (хранятся как хэш). GitHub OAuth access-token здесь НЕ возвращается
// (S4) — для git-операций используй pf_get_project_git_token (per-project, с аудитом).
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
        tokenAvailable: false;
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

  // Объявить бэкенд приложения проекту (SQLite-per-project). Возвращает app-ключ ОДИН раз.
  async declareAppSchema(
    projectId: string,
    schema: unknown,
  ): Promise<{ appKey: string; status: string }> {
    return this.request<{ appKey: string; status: string }>(
      `/agent/projects/${encodeURIComponent(projectId)}/app-backend`,
      { method: 'POST', body: { schema } },
    );
  }

  async listPendingAiPromptJobs(limit: number): Promise<PendingAiPromptJob[]> {
    const { jobs } = await this.request<{ jobs: PendingAiPromptJob[] }>(
      `/agent/pending-ai-prompt-jobs?limit=${limit}`,
    );
    return jobs;
  }

  async claimAiPromptJob(jobId: string): Promise<AiPromptJobClaimed> {
    const { job } = await this.request<{ job: AiPromptJobClaimed }>(
      `/agent/ai-prompt-jobs/${encodeURIComponent(jobId)}/claim`,
      { method: 'POST', body: {} },
    );
    return job;
  }

  async completeAiPromptJob(jobId: string, input: CompleteAiPromptJobInput): Promise<void> {
    await this.request<void>(
      `/agent/ai-prompt-jobs/${encodeURIComponent(jobId)}/complete`,
      { method: 'POST', body: input },
    );
  }

  async listPendingMonitoringAnalysisJobs(limit: number): Promise<PendingMonitoringAnalysisJob[]> {
    const { jobs } = await this.request<{ jobs: PendingMonitoringAnalysisJob[] }>(
      `/agent/pending-monitoring-analysis-jobs?limit=${limit}`,
    );
    return jobs;
  }

  async claimMonitoringAnalysisJob(jobId: string): Promise<MonitoringAnalysisJobClaimed> {
    const { job } = await this.request<{ job: MonitoringAnalysisJobClaimed }>(
      `/agent/monitoring-analysis-jobs/${encodeURIComponent(jobId)}/claim`,
      { method: 'POST', body: {} },
    );
    return job;
  }

  async completeMonitoringAnalysisJob(
    jobId: string,
    input: CompleteMonitoringAnalysisJobInput,
  ): Promise<void> {
    await this.request<void>(
      `/agent/monitoring-analysis-jobs/${encodeURIComponent(jobId)}/complete`,
      { method: 'POST', body: input },
    );
  }

  async listPendingCommitSyncJobs(limit: number): Promise<PendingCommitSyncJob[]> {
    const { jobs } = await this.request<{ jobs: PendingCommitSyncJob[] }>(
      `/agent/pending-commit-sync-jobs?limit=${limit}`,
    );
    return jobs;
  }

  async claimCommitSyncJob(jobId: string): Promise<CommitSyncJobClaimed> {
    const { job } = await this.request<{ job: CommitSyncJobClaimed }>(
      `/agent/commit-sync-jobs/${encodeURIComponent(jobId)}/claim`,
      { method: 'POST', body: {} },
    );
    return job;
  }

  async completeCommitSyncJob(jobId: string, input: CompleteCommitSyncJobInput): Promise<void> {
    await this.request<void>(
      `/agent/commit-sync-jobs/${encodeURIComponent(jobId)}/complete`,
      { method: 'POST', body: input },
    );
  }

  async getAutomationConfig(projectId: string): Promise<AutomationForDispatcher> {
    return this.request<AutomationForDispatcher>(
      `/agent/projects/${encodeURIComponent(projectId)}/automation`,
    );
  }

  async recordAutomationTask(
    projectId: string,
    taskId: string,
  ): Promise<AutomationForDispatcher> {
    return this.request<AutomationForDispatcher>(
      `/agent/projects/${encodeURIComponent(projectId)}/automation/record-task`,
      { method: 'POST', body: { taskId } },
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

  async updateTask(projectId: string, taskId: string, patch: UpdateTaskInput): Promise<Task> {
    // Не шлём undefined-поля — старые серверы могут не понимать ralphMode и упасть на validate.
    const body: Record<string, unknown> = {};
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.ralphMode !== undefined) body.ralphMode = patch.ralphMode;
    if (patch.priority !== undefined) body.priority = patch.priority;
    if (patch.deadline !== undefined) body.deadline = patch.deadline;
    const { task } = await this.request<{ task: Task }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body },
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

  // --- мониторинг серверов (agent-push сборщик) ---
  async listMonitoredServers(projectId?: string): Promise<MonitoredServer[]> {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const { servers } = await this.request<{ servers: MonitoredServer[] }>(
      `/agent/monitoring/servers${q}`,
    );
    return servers;
  }

  async recordServerSnapshot(
    projectId: string,
    snapshot: ServerSnapshotPush,
  ): Promise<{ ok: boolean; snapshotId: string; serverId: string }> {
    return this.request<{ ok: boolean; snapshotId: string; serverId: string }>(
      `/agent/projects/${encodeURIComponent(projectId)}/monitoring/snapshots`,
      { method: 'POST', body: snapshot },
    );
  }

  // --- LIVE-стрим действий воркера ---
  // Ingest-эндпоинты под /api/agent (Bearer requireAgentToken + requireDispatcherAccess).
  // Шлём только определённые опциональные поля — старые серверы и валидаторы не должны
  // спотыкаться на undefined/null лишних ключах.
  async liveStartSession(
    projectId: string,
    taskId: string,
    body: LiveStartSessionInput,
  ): Promise<LiveStartSessionResult> {
    const payload: Record<string, unknown> = { agentName: body.agentName };
    if (body.attempt !== undefined) payload.attempt = body.attempt;
    if (body.model !== undefined) payload.model = body.model;
    if (body.headBefore !== undefined) payload.headBefore = body.headBefore;
    return this.request<LiveStartSessionResult>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/live/sessions`,
      { method: 'POST', body: payload },
    );
  }

  async liveAppendEvents(
    projectId: string,
    taskId: string,
    sessionId: string,
    events: LiveEventInput[],
  ): Promise<{ appended: number }> {
    return this.request<{ appended: number }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/live/sessions/${encodeURIComponent(sessionId)}/events`,
      { method: 'POST', body: { events } },
    );
  }

  async liveFinishSession(
    projectId: string,
    taskId: string,
    sessionId: string,
    body: LiveFinishSessionInput,
  ): Promise<{ ok: boolean }> {
    const payload: Record<string, unknown> = { status: body.status };
    if (body.headAfter !== undefined) payload.headAfter = body.headAfter;
    if (body.costUsd !== undefined) payload.costUsd = body.costUsd;
    if (body.tokensIn !== undefined) payload.tokensIn = body.tokensIn;
    if (body.tokensOut !== undefined) payload.tokensOut = body.tokensOut;
    if (body.fileDiffs !== undefined) payload.fileDiffs = body.fileDiffs;
    return this.request<{ ok: boolean }>(
      `/agent/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/live/sessions/${encodeURIComponent(sessionId)}/finish`,
      { method: 'POST', body: payload },
    );
  }
}

// --- LIVE-стрим действий воркера (Cursor-style лента в карточке задачи) ---
// Источник правды — REST из диспетчера (dispatch.ps1). Эти DTO дублируют контракт
// для не-PowerShell агентов, которые стримят через MCP-тулы.

export type LiveEventKind =
  | 'assistant_text'
  | 'tool_use'
  | 'file_edit'
  | 'file_write'
  | 'bash'
  | 'tool_error'
  | 'diff_summary'
  | 'file_diff'
  | 'session_finished';

export type LiveFileChange = 'added' | 'modified' | 'deleted' | 'renamed';

export type LiveSessionStatus = 'completed' | 'failed' | 'timeout' | 'canceled';

// Одно событие ленты. seq монотонно растёт в рамках задачи; payload — произвольный JSON.
export type LiveEventInput = {
  seq: number;
  kind: string;
  text?: string | null;
  payload?: unknown;
};

// Полный git-дифф файла, прикрепляемый при финализации сессии.
export type LiveFileDiffInput = {
  path: string;
  change: LiveFileChange;
  additions: number;
  deletions: number;
  unifiedDiff?: string | null;
  isBinary?: boolean;
  truncated?: boolean;
};

export type LiveStartSessionInput = {
  agentName: string;
  attempt?: number;
  model?: string | null;
  headBefore?: string | null;
};

export type LiveStartSessionResult = {
  sessionId: string;
  baseSeq: number;
};

export type LiveFinishSessionInput = {
  status: LiveSessionStatus;
  headAfter?: string | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  fileDiffs?: LiveFileDiffInput[];
};

// Сервер мониторинга, который сборщик должен опросить по SSH.
export type MonitoredServer = {
  id: string;
  projectId: string;
  name: string;
  kind: 'local' | 'remote';
  host: string | null;
  sshPort: number;
  sshUser: string | null;
  sshCredentialRef: string | null;
  pm2ProcessNames: string[] | null;
  nginxAccessLogPath: string | null;
  nginxErrorLogPath: string | null;
  deployPath: string | null;
  collectIntervalSeconds: number;
};

// Снимок, который сборщик пушит в PF. metrics/logs — произвольно-структурированные
// (сервер валидирует Zod-схемой). collectedAt — ISO-строка.
export type ServerSnapshotPush = {
  serverName: string;
  collectedAt: string;
  reachable: boolean;
  metrics?: unknown;
  logs?: unknown;
  dbHealth?: unknown;
  errors?: string[];
};

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
