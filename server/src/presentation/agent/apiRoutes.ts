import { Router, raw, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ListProjects } from '../../application/project/ListProjects.js';
import type { ProjectNotificationService } from '../../application/notifications/ProjectNotificationService.js';
import type { DispatchCommentNotifications } from '../../application/notifications/DispatchCommentNotifications.js';
import type { CreateProjectWithGit } from '../../application/project/CreateProjectWithGit.js';
import type { UpdateProject } from '../../application/project/UpdateProject.js';
import type { ListUserRepos } from '../../application/github/ListUserRepos.js';
import type { GithubRepoSummary } from '../../domain/github/GithubConnection.js';
import type { ListKbDocuments } from '../../application/kb/ListKbDocuments.js';
import type { GetAgentCredential } from '../../application/agent/GetAgentCredential.js';
import type { GetAgentTask } from '../../application/agent/GetAgentTask.js';
import type { CreateAgentCredential } from '../../application/agent/CreateAgentCredential.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { ListTasks } from '../../application/task/ListTasks.js';
import type { CreateTask } from '../../application/task/CreateTask.js';
import type { CreateTaskComment } from '../../application/task/CreateTaskComment.js';
import type { ListTaskCommentsForAgent } from '../../application/task/ListTaskCommentsForAgent.js';
import type { MaybeReopenForClarification } from '../../application/task/MaybeReopenForClarification.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import type { SendAgentTelegramNotification } from '../../application/telegram/SendAgentTelegramNotification.js';
import type { BroadcastTelegramNotificationByTask } from '../../application/telegram/BroadcastTelegramNotificationByTask.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type { MoveTask } from '../../application/task/MoveTask.js';
import type { LinkCommit } from '../../application/task/LinkCommit.js';
import type { WriteKbDocument } from '../../application/kb/WriteKbDocument.js';
import type { ListPendingAiPromptJobs } from '../../application/ai-prompt/ListPendingAiPromptJobs.js';
import type { ClaimAiPromptJob } from '../../application/ai-prompt/ClaimAiPromptJob.js';
import type { CompleteAiPromptJob } from '../../application/ai-prompt/CompleteAiPromptJob.js';
import type { GetAiPromptKbBundle } from '../../application/ai-prompt/GetAiPromptKbBundle.js';
import { AiPromptRateLimitedError, type EnqueueAiPromptJob } from '../../application/ai-prompt/EnqueueAiPromptJob.js';
import type { WaitForAiPromptJob } from '../../application/ai-prompt/WaitForAiPromptJob.js';
import type { ListPendingMonitoringAnalysisJobs } from '../../application/monitoring-analysis/ListPendingMonitoringAnalysisJobs.js';
import type { ClaimMonitoringAnalysisJob } from '../../application/monitoring-analysis/ClaimMonitoringAnalysisJob.js';
import type { CompleteMonitoringAnalysisJob } from '../../application/monitoring-analysis/CompleteMonitoringAnalysisJob.js';
import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import type { PendingMonitoringAnalysisJob } from '../../application/monitoring-analysis/MonitoringAnalysisJobRepository.js';
import {
  AiPromptDispatcherNotConfiguredError,
  AiPromptJobAccessDeniedError,
  AiPromptJobNotFoundError,
  AiPromptProjectHasNoDispatcherError,
} from '../../domain/ai-prompt/errors.js';
import type { UploadTaskAttachment } from '../../application/task/UploadTaskAttachment.js';
import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import type { PendingAiPromptJob } from '../../application/ai-prompt/AiPromptJobRepository.js';
import type { AckRalphCancel } from '../../application/task/AckRalphCancel.js';
import type { CheckRepoUsage } from '../../application/agent/CheckRepoUsage.js';
import type { RequestRepoAccess } from '../../application/agent/RequestRepoAccess.js';
import type { InitLocalKb } from '../../application/kb/InitLocalKb.js';
import type { UpdateTask } from '../../application/task/UpdateTask.js';
import type { DeleteTask } from '../../application/task/DeleteTask.js';
import type { ListTaskCommits } from '../../application/task/ListTaskCommits.js';
import type { SyncTaskCommits } from '../../application/task/SyncTaskCommits.js';
import type { SearchTasks } from '../../application/task/SearchTasks.js';
import type { GetProject } from '../../application/project/GetProject.js';
import type { ListProjectMembers } from '../../application/project/ListProjectMembers.js';
import type { GetProjectFinance } from '../../application/finance/GetProjectFinance.js';
import type { ManageProjectFinance } from '../../application/finance/ManageProjectFinance.js';
import type { GetKbDocument } from '../../application/kb/GetKbDocument.js';
import type { DeleteKbDocument } from '../../application/kb/DeleteKbDocument.js';
import type { GetMyAccount } from '../../application/agent/GetMyAccount.js';
import type { DeleteProject } from '../../application/project/DeleteProject.js';
import type { ListMyDispatchedProjects } from '../../application/agent/ListMyDispatchedProjects.js';
import type { GetAutomationForDispatcher } from '../../application/automation/GetAutomationForDispatcher.js';
import type { RecordAutomationTask } from '../../application/automation/RecordAutomationTask.js';
import type { AutomationForDispatcher } from '../../application/automation/automationView.js';
import type { SetProjectDispatcher } from '../../application/project/SetProjectDispatcher.js';
import type { GetDelegatedGitToken } from '../../application/project/GetDelegatedGitToken.js';
import type { IngestAgentSnapshot } from '../../application/monitoring/IngestAgentSnapshot.js';
import type { ListMonitoredServers } from '../../application/monitoring/ListMonitoredServers.js';
import { ingestSnapshotSchema } from '../monitoring/schemas.js';
import type {
  DbHealth,
  LogTails,
  SnapshotMetrics,
} from '../../domain/monitoring/ServerSnapshot.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import { normalizeGitUrl } from '../../application/project/gitUrl.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import type { Project } from '../../domain/project/Project.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { ProjectMemberWithUser } from '../../application/project/ProjectMemberRepository.js';
import type { ProjectFinance } from '../../domain/finance/types.js';
import type { TaskSearchResult } from '../../application/task/TaskSearchRepository.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import {
  taskStatusSchema,
  linkCommitSchema,
  createTaskSchema,
  createAgentTaskCommentSchema,
} from '../tasks/schemas.js';
import { writeDocSchema } from '../kb/schemas.js';

type Deps = {
  readonly authenticate: AuthenticateAgentToken;
  readonly listProjects: ListProjects;
  readonly createProjectWithGit: CreateProjectWithGit;
  readonly updateProject: UpdateProject;
  readonly listUserRepos: ListUserRepos;
  readonly listKbDocuments: ListKbDocuments;
  readonly getCredential: GetAgentCredential;
  readonly createCredential: CreateAgentCredential;
  readonly listTasks: ListTasks;
  readonly getTask: GetAgentTask;
  readonly createTask: CreateTask;
  readonly createComment: CreateTaskComment;
  readonly listTaskCommentsForAgent: ListTaskCommentsForAgent;
  // Generic «в проекте изменились задачи» — для SSE task_changed (новые поля
  // ralph_cancel и т.п. подтянутся при refetch'е в UI).
  readonly notifyTaskChanged: (projectId: string) => void;
  readonly notifyCommentAdded: (
    projectId: string,
    taskId: string,
    commentId: string,
    ownerUserId: string,
    actorKind?: 'user' | 'agent' | 'system',
    agentName?: string | null,
  ) => void;
  readonly notifyStatusChanged: (
    projectId: string,
    taskId: string,
    oldStatus: string,
    newStatus: string,
    actorUserId: string,
  ) => void;
  readonly taskRepo: TaskRepository;
  readonly maybeReopenForClarification: MaybeReopenForClarification;
  readonly moveTask: MoveTask;
  readonly linkCommit: LinkCommit;
  readonly writeKbDocument: WriteKbDocument;
  readonly listPendingAiPromptJobs: ListPendingAiPromptJobs;
  readonly claimAiPromptJob: ClaimAiPromptJob;
  readonly completeAiPromptJob: CompleteAiPromptJob;
  readonly getAiPromptKbBundle: GetAiPromptKbBundle;
  readonly enqueueAiPromptJob: EnqueueAiPromptJob;
  readonly waitForAiPromptJob: WaitForAiPromptJob;
  readonly listPendingMonitoringAnalysisJobs: ListPendingMonitoringAnalysisJobs;
  readonly claimMonitoringAnalysisJob: ClaimMonitoringAnalysisJob;
  readonly completeMonitoringAnalysisJob: CompleteMonitoringAnalysisJob;
  readonly uploadTaskAttachment: UploadTaskAttachment;
  readonly maxAttachmentBytes: number;
  readonly ackRalphCancel: AckRalphCancel;
  readonly checkRepoUsage: CheckRepoUsage;
  readonly requestRepoAccess: RequestRepoAccess;
  readonly initLocalKb: InitLocalKb;
  readonly updateTask: UpdateTask;
  readonly deleteTask: DeleteTask;
  readonly listTaskCommits: ListTaskCommits;
  readonly syncTaskCommits: SyncTaskCommits;
  readonly searchTasks: SearchTasks;
  readonly getProject: GetProject;
  readonly listProjectMembers: ListProjectMembers;
  readonly getKbDocument: GetKbDocument;
  readonly deleteKbDocument: DeleteKbDocument;
  readonly getProjectFinance: GetProjectFinance;
  readonly manageProjectFinance: ManageProjectFinance;
  readonly getMyAccount: GetMyAccount;
  readonly deleteProject: DeleteProject;
  readonly listMyDispatchedProjects: ListMyDispatchedProjects;
  readonly getAutomationForDispatcher: GetAutomationForDispatcher;
  readonly recordAutomationTask: RecordAutomationTask;
  readonly ingestAgentSnapshot: IngestAgentSnapshot;
  readonly listMonitoredServers: ListMonitoredServers;
  readonly setProjectDispatcher: SetProjectDispatcher;
  readonly getDelegatedGitToken: GetDelegatedGitToken;
  readonly rateLimiter: InMemoryRateLimiter;
  // Email-оповещения команде (источник 'mcp' — действия агента). Fire-and-forget.
  readonly notifier: ProjectNotificationService;
  // Оркестратор уведомлений по комментарию: email+TG адресно + журнал доставки.
  readonly dispatchCommentNotifications: DispatchCommentNotifications;
  // Multi-user TG-уведомления (Ralph → @projectsflow_bot → юзер).
  readonly sendTelegramNotification: SendAgentTelegramNotification;
  readonly broadcastTelegramByTask: BroadcastTelegramNotificationByTask;
  // Нужны для members-эндпоинта (isOwner = userId === project.ownerId; hasTelegram batch).
  readonly projects: ProjectRepository;
  readonly users: UserRepository;
};

// /agent/notifications/telegram payload (v2). taskId XOR userId (хотя бы один).
// taskId — fan-out на всех members проекта (caller сам исключается, см. handler).
// userId — точечная отправка одному. Если оба → приоритет у userId.
const telegramNotifySchema = z
  .object({
    taskId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    text: z.string().min(1).max(4096),
    parseMode: z.enum(['HTML', 'MarkdownV2']).optional(),
    kind: z.string().min(1).max(64),
    replyMarkup: z.unknown().optional(),
    skipDedupCheck: z.boolean().optional(),
    // v2: учитывать prefs получателя (default true). При false — слать всем привязанным
    // независимо от настроек (high-priority / admin override).
    respectPrefs: z.boolean().optional(),
    // Spec telegram-reply-to-ralph-answer.md: для kind ∈ {ralph_question,
    // ralph_question_reminder} caller (Ralph) передаёт id вопроса из
    // <!-- ralph-question {"id":"..."} -->. Бэк сохранит маппинг message_id→question_id
    // чтобы матчить reply'и юзера в webhook'е. 64 — соответствует varchar в schema.
    ralphQuestionId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((b) => Boolean(b.taskId || b.userId), {
    message: 'Either taskId or userId must be provided',
    path: ['taskId'],
  });

const createCredentialSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(80).nullable().optional(),
  slug: z.string().trim().min(1).max(80).nullable().optional(),
  fields: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        value: z.string().max(20_000),
        isSecret: z.boolean(),
      }),
    )
    .min(1, 'нужно хотя бы одно поле')
    .max(50),
});

const moveTaskAgentSchema = z.object({
  targetStatus: taskStatusSchema,
});

// Query-параметры для GET /projects/:id/tasks/:id/comments (Ralph F11). Все опциональны.
// has_marker валидируем по белому списку — это подставится в SQL LIKE.
const listCommentsQuerySchema = z.object({
  since: z
    .string()
    .datetime({ offset: true, message: 'since должен быть ISO 8601 datetime' })
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  has_marker: z
    .enum(['ralph-question', 'ralph-answer', 'ralph-grillme-summary'])
    .optional(),
});

const repoAccessRequestSchema = z.object({
  gitRepoUrl: z.string().trim().min(1).max(500),
  requestTarget: z.string().trim().min(1).max(200),
  message: z.string().max(2000).optional(),
});

const recordAutomationTaskBodySchema = z.object({
  taskId: z.string().trim().min(1).max(64),
});

const updateTaskAgentSchema = z
  .object({
    description: z.string().trim().min(1).max(50_000).optional(),
    // Worker может выставить режим (например 'silent' → дальше работает без вопросов).
    ralphMode: z.enum(['normal', 'silent', 'grillme']).optional(),
    // Срок выполнения 'YYYY-MM-DD'. null = очистить. См. db/041.
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD')
      .nullable()
      .optional(),
    // Приоритет 1..4. null = убрать.
    priority: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .nullable()
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Нечего обновлять' });

// KB-путь: тот же контракт, что у pf_write_kb_document — относительный .md внутри репо.
const kbPathSchema = z.string().trim().regex(/^[a-z0-9_./-]+\.md$/i, 'путь должен быть вида folder/file.md');

// ISO date-only (YYYY-MM-DD). Опционально; дефолт «сегодня» в use-case.
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате YYYY-MM-DD');

// Деньги от агента — в рублях (number). Роут конвертирует в копейки Math.round(rubles*100).
const addExpenseSchema = z.object({
  amountRubles: z.number().nonnegative(),
  category: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  incurredOn: isoDateSchema.optional(),
});

const addIncomeSchema = z.object({
  amountRubles: z.number().nonnegative(),
  source: z.string().max(200).optional(),
  receivedOn: isoDateSchema.optional(),
});

type TaskDto = Omit<Task, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
  commitCount?: number;
  commentCount?: number;
};

function taskToDto(t: Task & { commitCount?: number; commentCount?: number }): TaskDto {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

type CommitDto = Omit<TaskCommit, 'committedAt' | 'linkedAt'> & {
  committedAt: string;
  linkedAt: string;
};

function commitToDto(c: TaskCommit): CommitDto {
  return { ...c, committedAt: c.committedAt.toISOString(), linkedAt: c.linkedAt.toISOString() };
}

type CommentDto = Omit<TaskComment, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

function commentToDto(c: TaskComment): CommentDto {
  return { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

// AI-prompt-job: complete body (см. spec 2026-05-28-ai-prompt-improvement-design.md).
const completeAiPromptJobBodySchema = z
  .object({
    ok: z.boolean(),
    // 600000: compose-режим возвращает большую JSON-строку (2 варианта + сегменты);
    // improve кладёт plain-текст (обычно ≤2000). Колонка improved_text — MEDIUMTEXT (db/060).
    improvedText: z.string().max(600000).nullable().optional(),
    error: z.string().max(500).nullable().optional(),
  })
  .refine(
    (b) => (b.ok ? Boolean(b.improvedText && b.improvedText.trim().length > 0) : true),
    { message: 'improvedText required when ok=true', path: ['improvedText'] },
  )
  .refine(
    (b) => (b.ok ? true : Boolean(b.error && b.error.trim().length > 0)),
    { message: 'error required when ok=false', path: ['error'] },
  );

// AI-prompt-job submit/poll для AGENT-клиентов (PFCompanion) — зеркало web-схем (ai-prompt/routes.ts).
// Свободный текст до 50000 (как поле композера / описание задачи); compose-advanced — шире
// (JSON сегментов). input_text — MEDIUMTEXT (db/066), байтового потолка TEXT больше нет.
const enqueueAiPromptBodySchema = z
  .object({
    text: z.string().trim().min(1, 'text required').max(200000, 'text too long'),
    projectId: z
      .string()
      .uuid('projectId must be uuid')
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    mode: z.enum(['improve', 'compose', 'compose-advanced']).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.mode !== 'compose-advanced' && b.text.length > 50000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'text must be 1..50000 chars',
      });
    }
  });

// Тело kb-bundle: список projectId'ов, по которым диспетчер просит ПОЛНУЮ KB (compose pass-2).
const aiPromptKbBundleBodySchema = z.object({
  projectIds: z.array(z.string().uuid()).max(10),
});
const aiPromptWaitQuerySchema = z.object({
  wait: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 25))
    .pipe(z.number().int().min(1).max(60)),
});

type PendingAiPromptJobDto = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
};

function pendingAiPromptJobToDto(p: PendingAiPromptJob): PendingAiPromptJobDto {
  return {
    id: p.id,
    projectId: p.projectId,
    projectName: p.projectName,
    createdAt: p.createdAt.toISOString(),
  };
}

type AiPromptJobDto = {
  id: string;
  projectId: string | null;
  status: AiPromptJob['status'];
  // 'improve' | 'compose' — ralph по нему выбирает промпт и кол-во проходов Claude.
  mode: AiPromptJob['mode'];
  inputText: string;
  kbContext: string | null;
  claimedAt: string | null;
  createdAt: string;
};

function aiPromptJobToAgentDto(j: AiPromptJob): AiPromptJobDto {
  return {
    id: j.id,
    projectId: j.projectId,
    status: j.status,
    mode: j.mode,
    inputText: j.inputText,
    kbContext: j.kbContext,
    claimedAt: j.claimedAt ? j.claimedAt.toISOString() : null,
    createdAt: j.createdAt.toISOString(),
  };
}

// Сериализация конфига автоматизации для диспетчера (даты → ISO).
function automationForDispatcherToDto(v: AutomationForDispatcher): {
  enabled: boolean;
  shouldRun: boolean;
  limitKind: AutomationForDispatcher['limitKind'];
  limitCount: number | null;
  limitMinutes: number | null;
  tasksCreated: number;
  runStartedAt: string | null;
  runStatus: AutomationForDispatcher['runStatus'];
  pauseMinSeconds: number;
  pauseMaxSeconds: number;
  ralphMode: string;
  gitAuthorMode: AutomationForDispatcher['gitAuthorMode'];
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  ignoreClaudeMd: boolean;
  ultracodeReviewEnabled: boolean;
  deployMethod: AutomationForDispatcher['deployMethod'];
  deployCommand: string | null;
  nextCriterion: AutomationForDispatcher['nextCriterion'];
} {
  return {
    enabled: v.enabled,
    shouldRun: v.shouldRun,
    limitKind: v.limitKind,
    limitCount: v.limitCount,
    limitMinutes: v.limitMinutes,
    tasksCreated: v.tasksCreated,
    runStartedAt: v.runStartedAt ? v.runStartedAt.toISOString() : null,
    runStatus: v.runStatus,
    pauseMinSeconds: v.pauseMinSeconds,
    pauseMaxSeconds: v.pauseMaxSeconds,
    ralphMode: v.ralphMode,
    gitAuthorMode: v.gitAuthorMode,
    gitAuthorName: v.gitAuthorName,
    gitAuthorEmail: v.gitAuthorEmail,
    ignoreClaudeMd: v.ignoreClaudeMd,
    ultracodeReviewEnabled: v.ultracodeReviewEnabled,
    deployMethod: v.deployMethod,
    deployCommand: v.deployCommand,
    nextCriterion: v.nextCriterion,
  };
}

// git-опция при создании проекта: подключить существующий репо / создать новый / никакой.
const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  git: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('none') }),
      z.object({ mode: z.literal('connect'), gitRepoUrl: z.string().url() }),
      z.object({
        mode: z.literal('create'),
        repoName: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(350).optional(),
        private: z.boolean().optional(),
      }),
    ])
    .optional(),
});

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    gitRepoUrl: z.string().url().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.gitRepoUrl !== undefined, {
    message: 'нужно хотя бы одно поле (name или gitRepoUrl)',
  });

type ProjectDto = {
  id: string;
  name: string;
  status: Project['status'];
  hasKb: boolean;
  gitRepoUrl: string | null;
  // Ralph-диспетчер: какой юзер автономно выполняет задачи. NULL = ручной режим.
  dispatcherUserId: string | null;
  // Удобный флаг для агента: «этот проект сейчас на мне». Заполняется при наличии
  // currentUserId — иначе undefined (для /agent/projects без знания обладателя токена
  // мы знаем актора, но в DTO-функции его не прокидываем — заполняется на месте).
  isMyDispatch?: boolean;
};

function projectToAgentDto(p: Project, currentUserId?: string): ProjectDto {
  const dto: ProjectDto = {
    id: p.id,
    name: p.name,
    status: p.status,
    hasKb: p.kbKind !== 'none',
    gitRepoUrl: p.gitRepoUrl,
    dispatcherUserId: p.dispatcherUserId,
  };
  if (currentUserId !== undefined) {
    dto.isMyDispatch = p.dispatcherUserId === currentUserId;
  }
  return dto;
}

type RepoDto = {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
};

function repoToDto(r: GithubRepoSummary): RepoDto {
  return {
    fullName: r.fullName,
    htmlUrl: r.htmlUrl,
    description: r.description,
    private: r.private,
    pushedAt: r.pushedAt ? r.pushedAt.toISOString() : null,
  };
}

// date-only Date → 'YYYY-MM-DD' (финансовые даты хранятся без времени).
function dateOnlyToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type MemberDto = {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectMemberWithUser['role'];
  isAdmin: boolean;
  // v2: каноничный владелец проекта (userId === project.ownerId). Может быть несколько
  // role='owner' members; isOwner — это «оригинальный» владелец из projects.owner_id.
  isOwner: boolean;
  // v2: есть ли у юзера привязка TG (по users.telegram_user_id IS NOT NULL).
  // Ralph использует чтобы решить, имеет ли смысл звать /notifications/telegram.
  hasTelegram: boolean;
  joinedAt: string;
};

function memberToDto(
  m: ProjectMemberWithUser,
  opts: { ownerId: string; telegramUserIds: ReadonlySet<string> },
): MemberDto {
  return {
    userId: m.userId,
    displayName: m.user.displayName,
    email: m.user.email,
    role: m.role,
    isAdmin: m.user.isAdmin,
    isOwner: m.userId === opts.ownerId,
    hasTelegram: opts.telegramUserIds.has(m.userId),
    joinedAt: m.joinedAt.toISOString(),
  };
}

type KbDocDto = {
  path: string;
  frontmatter: KbDocument['frontmatter'];
  body: string;
  sha: string | null;
};

function kbDocToDto(d: KbDocument): KbDocDto {
  return { path: d.path, frontmatter: d.frontmatter, body: d.body, sha: d.sha };
}

type KbDocSummaryDto = {
  path: string;
  title: string | null;
  kind: string | null;
  frontmatter: KbDocumentSummary['frontmatter'];
  sha: string | null;
};

function kbDocSummaryToDto(d: KbDocumentSummary): KbDocSummaryDto {
  return {
    path: d.path,
    title: (d.frontmatter['title'] as string | undefined) ?? null,
    kind: (d.frontmatter['kind'] as string | undefined) ?? null,
    frontmatter: d.frontmatter,
    sha: d.sha,
  };
}

// Финансовая сводка. Суммы — в копейках (точность); агенту дополнительно удобны рубли,
// но конвертацию делает MCP-обёртка (см. дизайн). Даты — date-only ISO.
type FinanceDto = {
  laborTotalKopecks: number;
  otherExpensesTotalKopecks: number;
  incomeTotalKopecks: number;
  expenseTotalKopecks: number;
  profitKopecks: number;
  marginPercent: number | null;
  labor: Array<{
    assignmentId: string;
    employeeId: string;
    employeeName: string;
    monthlySalaryKopecks: number;
    allocationPercent: number;
    startedAt: string;
    endedAt: string | null;
    costKopecks: number;
  }>;
  expenses: Array<{
    id: string;
    amountKopecks: number;
    category: string;
    description: string | null;
    incurredOn: string;
  }>;
  incomes: Array<{
    id: string;
    amountKopecks: number;
    source: string | null;
    receivedOn: string;
  }>;
};

function financeToDto(f: ProjectFinance): FinanceDto {
  return {
    laborTotalKopecks: f.laborTotalKopecks,
    otherExpensesTotalKopecks: f.otherExpensesTotalKopecks,
    incomeTotalKopecks: f.incomeTotalKopecks,
    expenseTotalKopecks: f.expenseTotalKopecks,
    profitKopecks: f.profitKopecks,
    marginPercent: f.marginPercent,
    labor: f.labor.map((l) => ({
      assignmentId: l.assignmentId,
      employeeId: l.employeeId,
      employeeName: l.employeeName,
      monthlySalaryKopecks: l.monthlySalaryKopecks,
      allocationPercent: l.allocationPercent,
      startedAt: dateOnlyToIso(l.startedAt),
      endedAt: l.endedAt ? dateOnlyToIso(l.endedAt) : null,
      costKopecks: l.costKopecks,
    })),
    expenses: f.expenses.map((e) => ({
      id: e.id,
      amountKopecks: e.amountKopecks,
      category: e.category,
      description: e.description,
      incurredOn: dateOnlyToIso(e.incurredOn),
    })),
    incomes: f.incomes.map((i) => ({
      id: i.id,
      amountKopecks: i.amountKopecks,
      source: i.source,
      receivedOn: dateOnlyToIso(i.receivedOn),
    })),
  };
}

// Endpoints для agents (MCP-сервер). Авторизация через Bearer-токен.
export function agentApiRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAgentToken(deps.authenticate));

  // Список проектов юзера, к которому привязан токен. Возвращаем минимум meta:
  // id, name, hasKb, gitRepoUrl — этого достаточно агенту чтоб выбрать.
  router.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listProjects.execute(req.user!.id);
      const me = req.user!.id;
      res.json({
        projects: list.map((p: Project) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          hasKb: p.kbKind !== 'none',
          gitRepoUrl: p.gitRepoUrl,
          dispatcherUserId: p.dispatcherUserId,
          isMyDispatch: p.dispatcherUserId === me,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  // GitHub-репозитории пользователя — чтобы перед созданием проекта агент мог найти
  // похожий по названию и предложить «подключить существующий».
  router.get('/repos', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repos = await deps.listUserRepos.execute(req.user!.id);
      res.json({ repos: repos.map(repoToDto) });
    } catch (e) {
      next(e);
    }
  });

  // Создание нового проекта. git-режим выбирает пользователь (агент спрашивает заранее):
  // none — без репо; connect — привязать существующий gitRepoUrl; create — завести
  // новый репозиторий под GitHub-аккаунтом пользователя и привязать его.
  router.post('/projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const project = await deps.createProjectWithGit.execute({
        ownerId: req.user!.id,
        name: body.name,
        git: body.git ?? { mode: 'none' },
      });
      res.status(201).json({ project: projectToAgentDto(project, req.user!.id) });
    } catch (e) {
      next(e);
    }
  });

  // Изменение проекта: переименование и/или привязка git-репо. Требует роль editor+.
  router.patch('/projects/:projectId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const body = updateProjectSchema.parse(req.body);
      const project = await deps.updateProject.execute({
        id: projectId,
        ownerId: req.user!.id,
        patch: { name: body.name, gitRepoUrl: body.gitRepoUrl },
      });
      res.json({ project: projectToAgentDto(project, req.user!.id) });
    } catch (e) {
      next(e);
    }
  });

  // Список credential-файлов в проекте (только path + title из frontmatter, без секретов).
  // Агент использует это чтобы найти нужный slug.
  router.get(
    '/projects/:projectId/credentials',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const docs = await deps.listKbDocuments.execute(projectId, req.user!.id);
        const creds = docs
          .filter((d: KbDocumentSummary) => d.path.startsWith('credentials/'))
          .map((d: KbDocumentSummary) => ({
            slug: d.path.replace(/^credentials\//, '').replace(/\.md$/, ''),
            path: d.path,
            title: (d.frontmatter['title'] as string | undefined) ?? null,
            kind: (d.frontmatter['kind'] as string | undefined) ?? null,
          }));
        res.json({ credentials: creds });
      } catch (e) {
        next(e);
      }
    },
  );

  // Получение полного credential'а с резолвленными vault://-полями. Plaintext-секреты!
  router.get(
    '/projects/:projectId/credentials/:slug',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const slug = req.params['slug'] as string;
        const credential = await deps.getCredential.execute(projectId, req.user!.id, slug);
        res.json({ credential });
      } catch (e) {
        next(e);
      }
    },
  );

  // Создание credential'а из агента: structured fields с явным isSecret.
  // Секреты идут в vault (secrets-таблица), публичные поля — во frontmatter.
  router.post(
    '/projects/:projectId/credentials',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = createCredentialSchema.parse(req.body);
        const result = await deps.createCredential.execute({
          projectId,
          userId: req.user!.id,
          title: body.title,
          kind: body.kind ?? null,
          slug: body.slug ?? null,
          fields: body.fields,
        });
        res.status(201).json({ credential: result });
      } catch (e) {
        next(e);
      }
    },
  );

  // Список tasks в проекте — для LLM-judgment'а в Claude Code. Агент читает список,
  // сопоставляет с diff/commit-message и предлагает юзеру move/link.
  router.get(
    '/projects/:projectId/tasks',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const list = await deps.listTasks.execute(projectId, req.user!.id);
        res.json({ tasks: list.map(taskToDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Создание task'а из агента. По умолчанию падает в TODO внизу колонки.
  router.post(
    '/projects/:projectId/tasks',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = createTaskSchema.parse(req.body);
        const task = await deps.createTask.execute({
          projectId,
          ownerUserId: req.user!.id,
          description: body.description,
          status: body.status ?? 'todo',
          ralphMode: body.ralphMode,
          deadline: body.deadline ?? null,
          priority: body.priority ?? null,
        });
        void deps.notifier.onTaskCreated(projectId, req.user!.id, task, 'mcp').catch(() => {});
        // taskToDto ожидает Task с commitCount, но из CreateTask он не приходит — оборачиваем
        // вручную с нулевым счётчиком; в БД у новой задачи коммитов нет по определению.
        res.status(201).json({ task: taskToDto({ ...task, commitCount: 0 }) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Полный task с binary'ями всех аттачей в base64 + список комментариев. Для
  // pf_get_task tool'а — вызывается когда агенту нужно увидеть скрины/файлы и
  // прочитать предыдущее обсуждение задачи. Comments по порядку (старые сверху).
  router.get(
    '/projects/:projectId/tasks/:taskId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const { task, attachments, comments } = await deps.getTask.execute(
          projectId,
          req.user!.id,
          taskId,
        );
        res.json({
          task: taskToDto(task),
          attachments: attachments.map(
            (a: TaskAttachment & { data: Buffer }) => ({
              id: a.id,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              uploadedAt: a.uploadedAt.toISOString(),
              dataBase64: a.data.toString('base64'),
            }),
          ),
          comments: comments.map(commentToDto),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Создание комментария к задаче из агента. Используется чтобы LLM оставляла
  // прогресс-апдейты по ходу работы: «начал», «обнаружил блокер», «PR открыт».
  // Mentions через @displayName парсятся существующим CreateTaskComment use-case'ом
  // и шлют notifications упомянутым юзерам. Comment author = owner текущего
  // agent-токена — т.е. под именем юзера, выпустившего токен.
  router.post(
    '/projects/:projectId/tasks/:taskId/comments',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const body = createAgentTaskCommentSchema.parse(req.body);
        // Дефолт 'ralph-dispatcher' — исторически все agent-комменты пишет он. Когда
        // другие агенты начнут писать (worker/grillme/verify), они передадут свой
        // agentName явно через MCP-tool.
        const agentName = body.agentName ?? 'ralph-dispatcher';
        const comment = await deps.createComment.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          body: body.body,
          actorKind: 'agent',
          agentName,
          // Agent-комменты адресуют всех (по mcp-prefs), без UI-выбора. notifyMode='all'.
          notifyMode: 'all',
        });
        // Адресные уведомления (email + TG) + журнал доставки, источник 'mcp'.
        // Для mcp дефолт comment_created — off: спама нет, но журнал зафиксирует
        // skipped/pref_off, а упомянутые (@mention) получат email принудительно.
        void deps.dispatchCommentNotifications
          .execute({
            projectId,
            actorUserId: req.user!.id,
            source: 'mcp',
            audience: { mode: 'all' },
            comment: {
              id: comment.id,
              taskId,
              body: body.body,
              actorKind: comment.actorKind,
              agentName: comment.agentName,
            },
          })
          .catch((err) => console.warn('[agent/comment-dispatch] failed:', err));
        deps.notifyCommentAdded(
          projectId,
          taskId,
          comment.id,
          req.user!.id,
          comment.actorKind,
          comment.agentName,
        );
        // Авто-возврат awaiting_clarification → in_progress по ralph-маркеру.
        // Best-effort: ошибка не должна ломать ответ.
        try {
          const reopened = await deps.maybeReopenForClarification.execute(taskId, body.body);
          if (reopened) {
            deps.notifyStatusChanged(
              projectId,
              taskId,
              reopened.oldStatus,
              reopened.newStatus,
              req.user!.id,
            );
          }
        } catch (err) {
          console.warn('[agent auto-reopen] failed for task', taskId, err);
        }
        res.status(201).json({ comment: commentToDto(comment) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Чтение комментариев задачи (Ralph F11 Q&A). body отдаётся как есть в markdown —
  // HTML-комментарии <!-- ralph-* --> внутри сохраняются нетронутыми (sanitization идёт
  // только в UI-рендерере, не в API). Поддержка фильтров since/limit/has_marker — для
  // оптимизации polling'а диспетчера.
  router.get(
    '/projects/:projectId/tasks/:taskId/comments',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const query = listCommentsQuerySchema.parse(req.query);
        const comments = await deps.listTaskCommentsForAgent.execute(
          projectId,
          req.user!.id,
          taskId,
          {
            since: query.since,
            limit: query.limit,
            markerSubstring: query.has_marker,
          },
        );
        res.json({
          comments: comments.map((c) => ({
            id: c.id,
            body: c.body,
            ownerUserId: c.ownerUserId,
            ownerDisplayName: c.ownerDisplayName,
            // actor_kind / agent_name (db/034) — без них фронт не отличит agent от user
            // и Ralph-диспетчер через pf_list_task_comments не сможет распознать свои
            // собственные комменты. Fallback 'user' — для старых записей до миграции 034.
            actorKind: c.actorKind ?? 'user',
            agentName: c.agentName ?? null,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
          })),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Перенос task на другой статус. before/after не принимаем — агент всегда кладёт
  // в конец целевой колонки (MoveTask с before=null/after=null). Юзер при необходимости
  // подвинет руками в UI; это краевой случай.
  router.post(
    '/projects/:projectId/tasks/:taskId/move',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const body = moveTaskAgentSchema.parse(req.body);
        const before = await deps.taskRepo.getById(taskId);
        const task = await deps.moveTask.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          targetStatus: body.targetStatus,
          beforeTaskId: null,
          afterTaskId: null,
        });
        if (before && before.status !== task.status) {
          deps.notifyStatusChanged(projectId, taskId, before.status, task.status, req.user!.id);
        }
        if (body.targetStatus === 'done') {
          void deps.notifier.onTaskDone(projectId, req.user!.id, task, 'mcp').catch(() => {});
        }
        res.json({ task: taskToDto(task) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Запись произвольного KB-документа (create или update). Если sha=null —
  // создаём новый файл; если sha передан — обновляем существующий (optimistic lock).
  router.post(
    '/projects/:projectId/kb/documents',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = writeDocSchema.parse(req.body);
        const result = await deps.writeKbDocument.execute({
          projectId,
          userId: req.user!.id,
          path: body.path,
          frontmatter: body.frontmatter as Frontmatter,
          body: body.body,
          sha: body.sha,
        });
        void deps.notifier
          .onKbUpdated(projectId, req.user!.id, body.path, 'mcp')
          .catch(() => {});
        res.status(201).json({ path: body.path, sha: result.sha });
      } catch (e) {
        next(e);
      }
    },
  );

  // Привязка коммита к task. SHA должен быть доступен на GitHub (commit запушен).
  // LinkCommit сам делает auto-transition `todo → in_progress` на первом коммите.
  router.post(
    '/projects/:projectId/tasks/:taskId/commits',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const body = linkCommitSchema.parse(req.body);
        const commit = await deps.linkCommit.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          sha: body.sha,
        });
        void deps.notifier.onCommitLinked(projectId, req.user!.id, taskId, 'mcp').catch(() => {});
        res.status(201).json({ commit: commitToDto(commit) });
      } catch (e) {
        next(e);
      }
    },
  );

  // === AI Prompt Jobs (Ralph: poll → claim → process → complete) ===
  // См. docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md
  // Ralph поллит вместе с обычными agent_jobs; короткий лайфтайм (≤25 сек long-poll
  // на стороне сайта), процессит через Claude и возвращает improved_text.

  // Список queued AI-prompt-job'ов где caller — диспетчер.
  router.get(
    '/pending-ai-prompt-jobs',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const limitParam = req.query['limit'];
        const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : undefined;
        const jobs = await deps.listPendingAiPromptJobs.execute({
          userId: req.user!.id,
          limit: Number.isFinite(limit) ? limit : undefined,
        });
        res.json({ jobs: jobs.map(pendingAiPromptJobToDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Атомарный claim: queued → running. Возвращает полный job с inputText + kbContext.
  router.post(
    '/ai-prompt-jobs/:jobId/claim',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jobId = req.params['jobId'] as string;
        const job = await deps.claimAiPromptJob.execute({ userId: req.user!.id, jobId });
        res.json({ job: aiPromptJobToAgentDto(job) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Финализация: running → succeeded | failed. Тело: { ok, improvedText?, error? }.
  // ok=true ⇒ improvedText обязателен; ok=false ⇒ error обязателен.
  router.post(
    '/ai-prompt-jobs/:jobId/complete',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jobId = req.params['jobId'] as string;
        const body = completeAiPromptJobBodySchema.parse(req.body);
        await deps.completeAiPromptJob.execute({
          userId: req.user!.id,
          jobId,
          ok: body.ok,
          improvedText: body.improvedText ?? null,
          error: body.error ?? null,
        });
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // compose pass-2: диспетчер (между двумя проходами Claude) просит ПОЛНУЮ KB
  // задетектированных проектов. Тело { projectIds }. KB читается от имени создателя job'а.
  router.post(
    '/ai-prompt-jobs/:jobId/kb-bundle',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jobId = req.params['jobId'] as string;
        const body = aiPromptKbBundleBodySchema.parse(req.body);
        const result = await deps.getAiPromptKbBundle.execute({
          userId: req.user!.id,
          jobId,
          projectIds: body.projectIds,
        });
        res.json(result);
      } catch (e) {
        next(e);
      }
    },
  );

  // === AI Prompt Jobs — SUBMIT + POLL для AGENT-клиентов (PFCompanion desktop) ===
  // Зеркало web-роутов /api/ai/prompt-jobs (presentation/ai-prompt/routes.ts), но под agent-токеном
  // (Bearer). Десктоп-клиент шлёт промпт → диспетчер (тот же поток pending/claim/complete выше)
  // улучшает текст → клиент long-poll'ит результат. Требует работающего диспетчера у проекта.
  router.post('/ai-prompt-jobs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = enqueueAiPromptBodySchema.parse(req.body);
      const job = await deps.enqueueAiPromptJob.execute({
        userId: req.user!.id,
        text: body.text,
        projectId: body.projectId,
        mode: body.mode,
      });
      res.status(201).json({ jobId: job.id, status: job.status, mode: job.mode, createdAt: job.createdAt.toISOString() });
    } catch (e) {
      if (e instanceof AiPromptRateLimitedError) { res.status(429).json({ error: 'rate_limited', message: e.message }); return; }
      if (e instanceof AiPromptDispatcherNotConfiguredError) { res.status(503).json({ error: 'ai_not_configured', message: 'AI временно недоступен' }); return; }
      if (e instanceof AiPromptProjectHasNoDispatcherError) { res.status(503).json({ error: 'no_dispatcher_for_project', message: 'У проекта не назначен диспетчер для AI-улучшений' }); return; }
      next(e);
    }
  });

  // GET /agent/ai-prompt-jobs/:jobId?wait=25 — long-poll результата (200 готово / 504 таймаут).
  router.get('/ai-prompt-jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params['jobId'] as string;
      const { wait } = aiPromptWaitQuerySchema.parse(req.query);
      const job = await deps.waitForAiPromptJob.execute({ userId: req.user!.id, jobId, maxWaitMs: wait * 1000 });
      if (job === null) { res.status(504).json({ error: 'timeout', jobId, status: 'queued' }); return; }
      res.json({
        jobId: job.id,
        status: job.status,
        mode: job.mode,
        improvedText: job.improvedText,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      });
    } catch (e) {
      if (e instanceof AiPromptJobNotFoundError) { res.status(404).json({ error: 'job_not_found' }); return; }
      if (e instanceof AiPromptJobAccessDeniedError) { res.status(403).json({ error: 'not_owner' }); return; }
      next(e);
    }
  });

  // === AI-анализ мониторинга — dispatcher poll/claim/complete (db/063) ===
  // Зеркало pending/claim/complete ai-prompt'а: Ralph поллит, забирает job с пред-собранным
  // контекстом (снимок/логи/алерты/тренд), анализирует через Claude, возвращает markdown.
  const completeMonitoringAnalysisBodySchema = z
    .object({
      ok: z.boolean(),
      resultMarkdown: z.string().max(300000).nullable().optional(),
      error: z.string().max(500).nullable().optional(),
      costUsd: z.number().nullable().optional(),
      tokensIn: z.number().int().nullable().optional(),
      tokensOut: z.number().int().nullable().optional(),
    })
    .refine((b) => (b.ok ? Boolean(b.resultMarkdown && b.resultMarkdown.trim().length > 0) : true), {
      message: 'resultMarkdown required when ok=true',
      path: ['resultMarkdown'],
    })
    .refine((b) => (b.ok ? true : Boolean(b.error && b.error.trim().length > 0)), {
      message: 'error required when ok=false',
      path: ['error'],
    });

  const pendingMonitoringAnalysisToDto = (p: PendingMonitoringAnalysisJob): Record<string, unknown> => ({
    id: p.id,
    projectId: p.projectId,
    projectName: p.projectName,
    serverId: p.serverId,
    serverName: p.serverName,
    analysisType: p.analysisType,
    createdAt: p.createdAt.toISOString(),
  });

  const monitoringAnalysisToAgentDto = (j: MonitoringAnalysisJob): Record<string, unknown> => ({
    id: j.id,
    projectId: j.projectId,
    serverId: j.serverId,
    status: j.status,
    analysisType: j.analysisType,
    alertId: j.alertId,
    note: j.note,
    context: j.context,
    claimedAt: j.claimedAt ? j.claimedAt.toISOString() : null,
    createdAt: j.createdAt.toISOString(),
  });

  router.get('/pending-monitoring-analysis-jobs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitParam = req.query['limit'];
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : undefined;
      const jobs = await deps.listPendingMonitoringAnalysisJobs.execute({
        userId: req.user!.id,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({ jobs: jobs.map(pendingMonitoringAnalysisToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/monitoring-analysis-jobs/:jobId/claim', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params['jobId'] as string;
      const job = await deps.claimMonitoringAnalysisJob.execute({ userId: req.user!.id, jobId });
      res.json({ job: monitoringAnalysisToAgentDto(job) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/monitoring-analysis-jobs/:jobId/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params['jobId'] as string;
      const body = completeMonitoringAnalysisBodySchema.parse(req.body);
      await deps.completeMonitoringAnalysisJob.execute({
        userId: req.user!.id,
        jobId,
        ok: body.ok,
        resultMarkdown: body.resultMarkdown ?? null,
        error: body.error ?? null,
        costUsd: body.costUsd ?? null,
        tokensIn: body.tokensIn ?? null,
        tokensOut: body.tokensOut ?? null,
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // === Загрузка вложения к задаче для AGENT-клиентов (PFCompanion) ===
  // Веб грузит multipart (web-only). Тут — сырые байты (octet-stream), filename/mimeType в query,
  // чтобы не раздувать через base64/JSON-лимит. Тот же use-case + лимит размера, что и веб.
  // Требует manage_attachments у проекта (owner/editor). Картинки из буфера и файлы шлёт клиент.
  router.post(
    '/projects/:projectId/tasks/:taskId/attachments',
    raw({ type: () => true, limit: deps.maxAttachmentBytes + 1024 }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const fnQ = req.query['filename'];
        const mtQ = req.query['mimeType'];
        const filename = typeof fnQ === 'string' && fnQ.length > 0 ? fnQ : 'attachment.bin';
        const mimeType = typeof mtQ === 'string' && mtQ.length > 0 ? mtQ : 'application/octet-stream';
        const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (data.byteLength === 0) {
          res.status(400).json({ error: 'no_file', message: 'Пустое вложение' });
          return;
        }
        const att = await deps.uploadTaskAttachment.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          filename,
          mimeType,
          data,
        });
        res.status(201).json({
          attachment: { id: att.id, filename: att.filename, mimeType: att.mimeType, sizeBytes: att.sizeBytes },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Ralph диспетчер ack-ит cancel: сбрасывает флаг ralph_cancel_requested_at чтобы UI
  // убрал «Отмена запрошена»-badge. Идемпотентно. См. spec C:/www/ralph/prompts/task-ralph-cancel.md §5.
  router.post(
    '/projects/:projectId/tasks/:taskId/ralph-cancel-ack',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        await deps.ackRalphCancel.execute({ projectId, taskId });
        deps.notifyTaskChanged(projectId);
        res.status(200).json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );

  // Приватная проверка занятости git-репо. Ответ не раскрывает чужие проекты/владельцев —
  // только ownership + непрозрачный requestTarget (при ownership=other). Rate-limit 30/мин.
  router.get('/repo-usage', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!deps.rateLimiter.hit(`repo-usage:${req.user!.id}`, 30, 60_000)) {
        res.status(429).json({ error: 'rate_limited', message: 'Слишком много проверок, попробуйте позже' });
        return;
      }
      const url = typeof req.query['gitRepoUrl'] === 'string' ? req.query['gitRepoUrl'] : '';
      const result = await deps.checkRepoUsage.execute(req.user!.id, url);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Запрос общего доступа к репо. Создаёт join-request чужому владельцу + уведомляет.
  // Идемпотентно; доступ выдаёт владелец на сайте. Анти-абьюз: 10 новых запросов/репо/сутки.
  router.post('/repo-access-requests', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = repoAccessRequestSchema.parse(req.body);
      const dailyKey = `repo-access:${req.user!.id}:${normalizeGitUrl(body.gitRepoUrl)}`;
      if (!deps.rateLimiter.hit(dailyKey, 10, 24 * 60 * 60_000)) {
        res.status(429).json({ error: 'rate_limited', message: 'Превышен суточный лимит запросов по этому репо' });
        return;
      }
      const result = await deps.requestRepoAccess.execute(
        req.user!.id,
        body.gitRepoUrl,
        body.requestTarget,
      );
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Создание ЛОКАЛЬНОЙ базы знаний проекта (без git-репо) — чтобы агент сразу сидил креды.
  router.post(
    '/projects/:projectId/kb/init-local',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        await deps.initLocalKb.execute(projectId, req.user!.id);
        res.status(201).json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );

  // Метаданные одного проекта. 404 если юзер не member (не утекаем существование чужого).
  router.get('/projects/:projectId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params['projectId'] as string;
      const project = await deps.getProject.execute(projectId, req.user!.id);
      if (!project) {
        res.status(404).json({ error: 'project_not_found' });
        return;
      }
      res.json({ project: projectToAgentDto(project, req.user!.id) });
    } catch (e) {
      next(e);
    }
  });

  // Состав команды проекта (viewer+). Без секретов — только публичный профиль участника.
  // v2: для каждого member'а добавлены isOwner (userId === project.ownerId — каноничный
  // владелец) и hasTelegram (есть ли привязка TG) — нужны Ralph-диспетчеру для логов
  // и pre-фильтрации перед /notifications/telegram.
  router.get(
    '/projects/:projectId/members',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const members = await deps.listProjectMembers.execute(projectId, req.user!.id);
        // Параллельно: проект (для ownerId) и батч TG-привязок по member-юзерам.
        const memberIds = members.map((m) => m.userId);
        const [project, telegramSet] = await Promise.all([
          deps.projects.getById(projectId),
          deps.users.findUsersWithTelegram(memberIds),
        ]);
        const ownerId = project?.ownerId ?? '';
        res.json({
          members: members.map((m) => memberToDto(m, { ownerId, telegramUserIds: telegramSet })),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Глобальный поиск по задачам. Scope — проекты юзера; admin видит все. Query — ?q=.
  router.get('/search/tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
      const results: TaskSearchResult[] = await deps.searchTasks.execute(req.user!.id, q, {
        isAdmin: req.user!.isAdmin,
      });
      res.json({ results });
    } catch (e) {
      next(e);
    }
  });

  // Полный список KB-документов проекта (path + frontmatter + sha, без body). В отличие
  // от /credentials отдаёт ВСЕ доки, не только credentials/.
  router.get(
    '/projects/:projectId/kb/documents',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const docs = await deps.listKbDocuments.execute(projectId, req.user!.id);
        res.json({ documents: docs.map(kbDocSummaryToDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Чтение одного KB-документа целиком (body + frontmatter + sha). path — query-параметр.
  router.get(
    '/projects/:projectId/kb/document',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const path = kbPathSchema.parse(req.query['path']);
        const doc = await deps.getKbDocument.execute(projectId, req.user!.id, path);
        res.json({ document: kbDocToDto(doc) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Удаление KB-документа (необратимо). path — query-параметр. Требует роль editor+ (manage_kb).
  router.delete(
    '/projects/:projectId/kb/document',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const path = kbPathSchema.parse(req.query['path']);
        await deps.deleteKbDocument.execute(projectId, req.user!.id, path);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Редактирование описания задачи (editor+). Меняем только description.
  router.patch(
    '/projects/:projectId/tasks/:taskId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const body = updateTaskAgentSchema.parse(req.body);
        const task = await deps.updateTask.execute({
          projectId,
          ownerUserId: req.user!.id,
          taskId,
          description: body.description,
          ralphMode: body.ralphMode,
          deadline: body.deadline,
          priority: body.priority,
        });
        res.json({ task: taskToDto(task) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Удаление задачи (необратимо). Чистит комментарии задачи. Требует роль editor+ (delete_task).
  router.delete(
    '/projects/:projectId/tasks/:taskId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        await deps.deleteTask.execute(projectId, req.user!.id, taskId);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Список коммитов, привязанных к задаче.
  router.get(
    '/projects/:projectId/tasks/:taskId/commits',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const taskId = req.params['taskId'] as string;
        const commits = await deps.listTaskCommits.execute(projectId, req.user!.id, taskId);
        res.json({ commits: commits.map(commitToDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Авто-синхронизация коммитов: тянет последние коммиты с GitHub и привязывает к задачам
  // по [short-id] в commit-message. Auto-transition todo → in_progress на первом коммите.
  router.post(
    '/projects/:projectId/sync-commits',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const result = await deps.syncTaskCommits.execute(projectId, req.user!.id);
        res.json(result);
      } catch (e) {
        next(e);
      }
    },
  );

  // Финансовая сводка проекта (P&L). Owner — всегда; не-владелец — только при
  // finance_visibility='members' (иначе use-case вернёт 403).
  router.get(
    '/projects/:projectId/finance',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const finance = await deps.getProjectFinance.execute(projectId, req.user!.id);
        res.json({ finance: financeToDto(finance) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Добавить расход (owner). amountRubles → копейки. incurredOn опционально (дефолт сегодня).
  router.post(
    '/projects/:projectId/finance/expenses',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = addExpenseSchema.parse(req.body);
        const expense = await deps.manageProjectFinance.addExpense(projectId, req.user!.id, {
          amountKopecks: Math.round(body.amountRubles * 100),
          category: body.category,
          description: body.description ?? null,
          incurredOn: body.incurredOn ? new Date(body.incurredOn) : new Date(),
        });
        res.status(201).json({
          expense: {
            id: expense.id,
            amountKopecks: expense.amountKopecks,
            category: expense.category,
            description: expense.description,
            incurredOn: dateOnlyToIso(expense.incurredOn),
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Какие проекты сейчас на текущем юзере как Ralph-диспетчере. Главный тул /loop'а:
  // агент дёргает в начале каждой итерации, чтобы понять «где есть работа». Возвращает
  // Project + счётчики (openTaskCount, pendingAiPromptJobCount), чтобы агент мог пропустить
  // «пустые» проекты без N лишних роунд-трипов.
  router.get('/me/dispatched-projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.user!.id;
      const list = await deps.listMyDispatchedProjects.execute(me);
      res.json({
        projects: list.map((d) => ({
          ...projectToAgentDto(d.project, me),
          openTaskCount: d.openTaskCount,
          pendingAiPromptJobCount: d.pendingAiPromptJobCount,
          // Включена ли автоматизация — чтобы диспетчер за один round-trip знал, какие
          // проекты опрашивать GET'ом /automation (без тяжёлого запроса с промптами).
          automationEnabled: d.automationEnabled,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  // Конфиг автоматизации проекта для диспетчера: shouldRun + следующий критерий с промптом.
  // Только назначенный диспетчер проекта (requireDispatcherAccess внутри use-case).
  router.get(
    '/projects/:projectId/automation',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const view = await deps.getAutomationForDispatcher.execute({
          projectId,
          userId: req.user!.id,
        });
        res.json(automationForDispatcherToDto(view));
      } catch (e) {
        next(e);
      }
    },
  );

  // Диспетчер сообщает, что создал очередную задачу автоматизации. Сервер инкрементит
  // счётчик, стартует прогон на первой задаче, продвигает round-robin, закрывает при лимите.
  router.post(
    '/projects/:projectId/automation/record-task',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = recordAutomationTaskBodySchema.parse(req.body);
        const view = await deps.recordAutomationTask.execute({
          projectId,
          userId: req.user!.id,
          taskId: body.taskId,
        });
        res.json(automationForDispatcherToDto(view));
      } catch (e) {
        next(e);
      }
    },
  );

  // Назначить / снять Ralph-диспетчера проекта. owner-only через use-case (отдельная
  // проверка роли внутри SetProjectDispatcher). userId === null = снять диспетчера.
  const setDispatcherBodySchema = z.object({
    userId: z.union([z.string().min(1), z.null()]),
  });
  router.put(
    '/projects/:projectId/dispatcher',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        // zod валидирует тело — ZodError маппится в 400 errorHandler'ом (раньше
        // inline-throw из IIFE становился непрозрачным 500).
        const { userId } = setDispatcherBodySchema.parse(req.body);
        const project = await deps.setProjectDispatcher.execute(
          projectId,
          req.user!.id,
          userId,
        );
        res.json({ project: projectToAgentDto(project, req.user!.id) });
      } catch (e) {
        next(e);
      }
    },
  );

  // Делегированный GitHub-токен для git-операций. v0.15: per-member opt-in.
  // Caller — текущий диспетчер проекта; сервер выбирает первого подходящего
  // granter'а в порядке owner→displayName ASC (caller исключается из кандидатов).
  // Токен берётся LIVE из user_github_tokens (рефрэш OAuth подхватывается).
  // Для КАЖДОГО исхода пишется audit-log — owner видит «кто и когда брал».
  //
  // Ошибки use-case'а маппятся в errorHandler:
  //   NotProjectDispatcherError       → 403 not_dispatcher
  //   GitTokenDelegationDisabledError → 403 delegation_disabled (никто не включил)
  //   NoEligibleGrantorError          → 403 no_eligible_grantor (включили, но без GH)
  router.get(
    '/projects/:projectId/git-token',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const token = await deps.getDelegatedGitToken.execute({
          projectId,
          callerUserId: req.user!.id,
        });
        // Никогда не печатаем token в app-логи — только outcome в access-log таблицу
        // (там нет значения, только факт + outcome). Здесь возвращаем юзеру и забываем.
        res.json({
          token: token.token,
          login: token.login,
          scopes: token.scopes,
          // v0.15: source может быть 'owner_delegation' либо 'member_delegation'
          source: token.source,
          grantedBy: token.grantedBy,
          // v0.15: + displayName для диагностики на стороне Ralph'а
          grantedByDisplayName: token.grantedByDisplayName,
          grantedAt: token.grantedAt.toISOString(),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Безвозвратное удаление проекта через agent-API (owner-only). Каскадно чистит
  // tasks/comments/commits/attachments-rows/kb_documents/secrets/finance/invites/
  // join_requests/members + сам проект. Inbox запрещён (409). Email-уведомления
  // остальным участникам fire-and-forget.
  router.delete(
    '/projects/:projectId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const result = await deps.deleteProject.execute(projectId, req.user!.id);
        void deps.notifier
          .onProjectDeleted({
            projectName: result.project.name,
            actorUserId: req.user!.id,
            actorDisplayName: req.user!.displayName,
            recipients: result.memberSnapshots.map((m) => ({
              userId: m.userId,
              email: m.user.email,
            })),
          })
          .catch(() => {});
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Профиль текущего юзера + всё, что MCP может выдать обратно: github-коннект с
  // OAuth-access-token'ом и список agent-токенов. Пароль НЕ возвращаем (хэш необратим).
  // Plaintext agent-токенов НЕ возвращаем (хранится только bcrypt-хэш).
  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const account = await deps.getMyAccount.execute(req.user!.id);
      res.json({
        user: {
          id: account.user.id,
          email: account.user.email,
          displayName: account.user.displayName,
          avatarUrl: account.user.avatarUrl,
          isAdmin: account.user.isAdmin,
          createdAt: account.user.createdAt.toISOString(),
          // Пояснение клиенту: пароль не возвращается принципиально (bcrypt-хэш).
          passwordHashed: true,
        },
        github: account.github
          ? {
              connected: true,
              login: account.github.githubLogin,
              githubUserId: account.github.githubUserId,
              scopes: account.github.scopes,
              connectedAt: account.github.connectedAt.toISOString(),
              // Plaintext OAuth-токен — твой собственный, по явному запросу.
              // Используй с тем же scope, что и сайт (GitHub API/git push/clone).
              accessToken: account.github.accessToken,
            }
          : { connected: false },
        agentTokens: account.agentTokens.map((t) => ({
          id: t.id,
          name: t.name,
          tokenPrefix: t.tokenPrefix,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
          revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
          isCurrent: t.id === req.agentTokenId,
          // Пояснение клиенту: plaintext-значение токена показывается ОДИН раз
          // при создании, после в БД лежит только bcrypt-хэш — восстановить нельзя.
          plaintextAvailable: false,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  // Добавить доход (owner). amountRubles → копейки. receivedOn опционально (дефолт сегодня).
  router.post(
    '/projects/:projectId/finance/incomes',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = addIncomeSchema.parse(req.body);
        const income = await deps.manageProjectFinance.addIncome(projectId, req.user!.id, {
          amountKopecks: Math.round(body.amountRubles * 100),
          source: body.source ?? null,
          receivedOn: body.receivedOn ? new Date(body.receivedOn) : new Date(),
        });
        res.status(201).json({
          income: {
            id: income.id,
            amountKopecks: income.amountKopecks,
            source: income.source,
            receivedOn: dateOnlyToIso(income.receivedOn),
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // Multi-user TG notification (v2 — unified body+response).
  // Body: { taskId? | userId?, text, kind, parseMode?, replyMarkup?, skipDedupCheck?,
  //         respectPrefs? }. Хотя бы один из taskId/userId. Если оба — приоритет userId.
  // Response (200):
  //   { ok: true, sent: N, skipped: [{ userId, reason, detail? }, ...] }
  // - taskId-режим: fan-out на всех members проекта (caller=req.user.id исключается).
  // - userId-режим: точечная отправка одному (sent=0 или 1).
  // Ошибки:
  //   400 invalid_body — невалидный payload
  //   404 task_not_found — taskId указан, задачи нет
  //   404 user_not_found — userId указан, юзера нет (не реализуем строго: send в этом
  //     случае вернёт not_connected → skipped; диспетчер увидит)
  router.post(
    '/notifications/telegram',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = telegramNotifySchema.parse(req.body);
        const respectPrefs = body.respectPrefs !== false;

        // Приоритет userId. taskId-fan-out только если userId не указан.
        if (body.userId) {
          const r = await deps.sendTelegramNotification.execute({
            userId: body.userId,
            text: body.text,
            parseMode: body.parseMode,
            kind: body.kind,
            taskId: body.taskId,
            replyMarkup: body.replyMarkup,
            skipDedupCheck: body.skipDedupCheck,
            skipPrefsCheck: !respectPrefs,
            ralphQuestionId: body.ralphQuestionId,
          });
          const userId = body.userId;
          // Унифицированный ответ. sent=1 только если 'ok'.
          if (r.status === 'ok') {
            res.json({
              ok: true,
              sent: 1,
              skipped: [],
              delivered: [{ userId, messageId: r.messageId }],
            });
            return;
          }
          const reason: string =
            r.status === 'forbidden' ? 'forbidden' : r.status;
          const detail =
            r.status === 'forbidden' || r.status === 'error'
              ? r.description
              : r.status === 'rate_limited'
                ? `retry_after=${r.retryAfter}`
                : undefined;
          res.json({
            ok: true,
            sent: 0,
            skipped: [{ userId, reason, ...(detail ? { detail } : {}) }],
            delivered: [],
          });
          return;
        }

        // taskId-режим (broadcast). 404 task_not_found бросается use-case'ом →
        // errorHandler возвращает соответствующий status. Caller исключается из получателей.
        const result = await deps.broadcastTelegramByTask.execute({
          taskId: body.taskId!,
          text: body.text,
          kind: body.kind,
          parseMode: body.parseMode,
          replyMarkup: body.replyMarkup,
          skipDedupCheck: body.skipDedupCheck,
          respectPrefs,
          skipUserId: req.user!.id,
          ralphQuestionId: body.ralphQuestionId,
        });
        res.json({
          ok: true,
          sent: result.sent,
          skipped: result.skipped,
          delivered: result.delivered,
        });
      } catch (e) {
        next(e);
      }
    },
  );

  // ===== Мониторинг серверов (agent-push сборщик) =====
  // Список remote-серверов для сбора. Не-admin видит только серверы своих проектов.
  router.get('/monitoring/servers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const servers = await deps.listMonitoredServers.execute(
        req.user!.id,
        req.user!.isAdmin === true,
      );
      res.json({ servers });
    } catch (e) {
      next(e);
    }
  });

  // Приём снимка от сборщика. Гейт manage_monitoring (owner) внутри use-case.
  router.post(
    '/projects/:projectId/monitoring/snapshots',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const projectId = req.params['projectId'] as string;
        const body = ingestSnapshotSchema.parse(req.body);
        const { snapshot, server } = await deps.ingestAgentSnapshot.execute({
          projectId,
          userId: req.user!.id,
          agentTokenId: req.agentTokenId ?? null,
          serverName: body.serverName,
          collectedAt: new Date(body.collectedAt),
          reachable: body.reachable,
          metrics: (body.metrics ?? null) as SnapshotMetrics | null,
          logs: (body.logs ?? null) as LogTails | null,
          dbHealth: (body.dbHealth ?? null) as DbHealth | null,
          errors: body.errors ?? null,
        });
        res.status(201).json({ ok: true, snapshotId: snapshot.id, serverId: server.id });
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
