// Composition root: собираем зависимости + поднимаем HTTP-сервер.

import { db, pool } from './infrastructure/db/index.js';
import { Argon2PasswordHasher } from './infrastructure/crypto/Argon2PasswordHasher.js';
import { idGenerator } from './infrastructure/id/idGenerator.js';
import { DrizzleUserRepository } from './infrastructure/repositories/DrizzleUserRepository.js';
import { DrizzleSessionRepository } from './infrastructure/repositories/DrizzleSessionRepository.js';
import { DrizzleProjectRepository } from './infrastructure/repositories/DrizzleProjectRepository.js';
import { DrizzleProjectMemberRepository } from './infrastructure/repositories/DrizzleProjectMemberRepository.js';
import { DrizzleProjectInviteRepository } from './infrastructure/repositories/DrizzleProjectInviteRepository.js';
import { DrizzleNotificationRepository } from './infrastructure/repositories/DrizzleNotificationRepository.js';
import { NotificationHub } from './infrastructure/notifications/NotificationHub.js';
import { RealtimeHub } from './infrastructure/realtime/RealtimeHub.js';
import { ProjectEventBroadcaster } from './application/realtime/ProjectEventBroadcaster.js';
import { PublishingNotificationRepository } from './infrastructure/notifications/PublishingNotificationRepository.js';
import { SmtpEmailSender } from './infrastructure/email/SmtpEmailSender.js';
import { LoggingEmailSender } from './infrastructure/email/LoggingEmailSender.js';
import type { EmailSender } from './application/notifications/EmailSender.js';
import { DrizzleGithubTokenRepository } from './infrastructure/repositories/DrizzleGithubTokenRepository.js';
import { FetchGithubApiClient } from './infrastructure/github/FetchGithubApiClient.js';
import { DeviceFlowStore } from './infrastructure/github/DeviceFlowStore.js';
import { Register } from './application/auth/Register.js';
import { Login } from './application/auth/Login.js';
import { Logout } from './application/auth/Logout.js';
import { GetCurrentUser } from './application/auth/GetCurrentUser.js';
import { UpdateProfile } from './application/user/UpdateProfile.js';
import { ListProjects } from './application/project/ListProjects.js';
import { configureAdminBypass } from './application/project/projectAccess.js';
import { GetProject } from './application/project/GetProject.js';
import { CreateProject } from './application/project/CreateProject.js';
import { UpdateProject } from './application/project/UpdateProject.js';
import { ReorderProjects } from './application/project/ReorderProjects.js';
import { ProjectNotificationService } from './application/notifications/ProjectNotificationService.js';
import { CreateProjectWithGit } from './application/project/CreateProjectWithGit.js';
import { GetOrCreateInbox } from './application/project/GetOrCreateInbox.js';
import { ListProjectMembers } from './application/project/ListProjectMembers.js';
import { RemoveProjectMember } from './application/project/RemoveProjectMember.js';
import { UpdateProjectMemberRole } from './application/project/UpdateProjectMemberRole.js';
import { TransferProjectOwnership } from './application/project/TransferProjectOwnership.js';
import { CreateProjectInvite } from './application/project/CreateProjectInvite.js';
import { ListProjectInvites } from './application/project/ListProjectInvites.js';
import { DeleteProjectInvite } from './application/project/DeleteProjectInvite.js';
import { ListSharedMembers } from './application/project/ListSharedMembers.js';
import { GetInviteByToken } from './application/project/GetInviteByToken.js';
import { AcceptProjectInvite } from './application/project/AcceptProjectInvite.js';
import { CheckGitCollision } from './application/project/CheckGitCollision.js';
import { RequestProjectJoin } from './application/project/RequestProjectJoin.js';
import { ResolveProjectJoinRequest } from './application/project/ResolveProjectJoinRequest.js';
import { DrizzleProjectJoinRequestRepository } from './infrastructure/repositories/DrizzleProjectJoinRequestRepository.js';
import { StartDeviceFlow } from './application/github/StartDeviceFlow.js';
import { PollDeviceFlow } from './application/github/PollDeviceFlow.js';
import { DisconnectGithub } from './application/github/DisconnectGithub.js';
import { ListUserRepos } from './application/github/ListUserRepos.js';
import { ListProjectCommits } from './application/github/ListProjectCommits.js';
import { GithubKbRepository } from './infrastructure/kb/GithubKbRepository.js';
import { GithubKbBackend } from './infrastructure/kb/GithubKbBackend.js';
import { LocalKbBackend } from './infrastructure/kb/LocalKbBackend.js';
import { DispatchingKbStore } from './infrastructure/kb/DispatchingKbStore.js';
import { DrizzleKbDocumentRepository } from './infrastructure/repositories/DrizzleKbDocumentRepository.js';
import { InitLocalKb } from './application/kb/InitLocalKb.js';
import { CheckRepoUsage } from './application/agent/CheckRepoUsage.js';
import { RequestRepoAccess } from './application/agent/RequestRepoAccess.js';
import { GetMyAccount } from './application/agent/GetMyAccount.js';
import { DeleteProject } from './application/project/DeleteProject.js';
import { SetProjectDispatcher } from './application/project/SetProjectDispatcher.js';
import { ListDispatcherCandidates } from './application/project/ListDispatcherCandidates.js';
import { ListMyDispatchedProjects } from './application/agent/ListMyDispatchedProjects.js';
import { pickDefaultDispatcherUserId } from './application/project/pickDefaultDispatcher.js';
import { SetGitTokenDelegation } from './application/project/SetGitTokenDelegation.js';
import { GetDelegatedGitToken } from './application/project/GetDelegatedGitToken.js';
import { ListGitTokenAccessLog } from './application/project/ListGitTokenAccessLog.js';
import { DrizzleGitTokenDelegationRepository } from './infrastructure/repositories/DrizzleGitTokenDelegationRepository.js';
import { InMemoryRateLimiter } from './infrastructure/ratelimit/InMemoryRateLimiter.js';
import { InitKbRepo } from './application/kb/InitKbRepo.js';
import { ConnectKbRepo } from './application/kb/ConnectKbRepo.js';
import { DisconnectKb } from './application/kb/DisconnectKb.js';
import { ListKbDocuments } from './application/kb/ListKbDocuments.js';
import { GetKbDocument } from './application/kb/GetKbDocument.js';
import { WriteKbDocument } from './application/kb/WriteKbDocument.js';
import { DeleteKbDocument } from './application/kb/DeleteKbDocument.js';
import { BulkCreateCredential } from './application/kb/BulkCreateCredential.js';
import { DrizzleTaskRepository } from './infrastructure/repositories/DrizzleTaskRepository.js';
import { DrizzleTaskCommitRepository } from './infrastructure/repositories/DrizzleTaskCommitRepository.js';
import { DrizzleTaskAttachmentRepository } from './infrastructure/repositories/DrizzleTaskAttachmentRepository.js';
import { DrizzleTaskCommentRepository } from './infrastructure/repositories/DrizzleTaskCommentRepository.js';
import { DrizzleTaskDelegationRepository } from './infrastructure/repositories/DrizzleTaskDelegationRepository.js';
import { FileSystemAttachmentStorage } from './infrastructure/storage/FileSystemAttachmentStorage.js';
import { DrizzleAgentTokenRepository } from './infrastructure/repositories/DrizzleAgentTokenRepository.js';
import { DrizzleAgentJobRepository } from './infrastructure/repositories/DrizzleAgentJobRepository.js';
import { EnqueueAgentJob } from './application/agent/EnqueueAgentJob.js';
import { CancelAgentJob } from './application/agent/CancelAgentJob.js';
import { ListAgentJobsForProject } from './application/agent/ListAgentJobsForProject.js';
import { ListPendingAgentJobs } from './application/agent/ListPendingAgentJobs.js';
import { ClaimAgentJob } from './application/agent/ClaimAgentJob.js';
import { CompleteAgentJob } from './application/agent/CompleteAgentJob.js';
import { Sha256AgentTokenHasher } from './infrastructure/crypto/Sha256AgentTokenHasher.js';
import { CreateAgentToken } from './application/agent/CreateAgentToken.js';
import { ListAgentTokens } from './application/agent/ListAgentTokens.js';
import { RevokeAgentToken } from './application/agent/RevokeAgentToken.js';
import { AuthenticateAgentToken } from './application/agent/AuthenticateAgentToken.js';
import { GetAgentCredential } from './application/agent/GetAgentCredential.js';
import { GetAgentTask } from './application/agent/GetAgentTask.js';
import { CreateAgentCredential } from './application/agent/CreateAgentCredential.js';
import { InMemoryAgentDeviceCodeStore } from './application/agent/AgentDeviceCodeStore.js';
import { RequestAgentDeviceCode } from './application/agent/RequestAgentDeviceCode.js';
import { ApproveAgentDeviceCode } from './application/agent/ApproveAgentDeviceCode.js';
import { PollAgentDeviceToken } from './application/agent/PollAgentDeviceToken.js';
import { GetAgentDeviceCodeInfo } from './application/agent/GetAgentDeviceCodeInfo.js';
import { randomBytes } from 'node:crypto';
import { ListTasks } from './application/task/ListTasks.js';
import { SearchTasks } from './application/task/SearchTasks.js';
import { DrizzleTaskSearchRepository } from './infrastructure/repositories/DrizzleTaskSearchRepository.js';
import { CreateTask } from './application/task/CreateTask.js';
import { UpdateTask } from './application/task/UpdateTask.js';
import { MoveTask } from './application/task/MoveTask.js';
import { DeleteTask } from './application/task/DeleteTask.js';
import { LinkCommit } from './application/task/LinkCommit.js';
import { UnlinkCommit } from './application/task/UnlinkCommit.js';
import { ListTaskCommits } from './application/task/ListTaskCommits.js';
import { SyncTaskCommits } from './application/task/SyncTaskCommits.js';
import { UploadTaskAttachment } from './application/task/UploadTaskAttachment.js';
import { DeleteTaskAttachment } from './application/task/DeleteTaskAttachment.js';
import { ListTaskAttachments } from './application/task/ListTaskAttachments.js';
import { GetTaskAttachment } from './application/task/GetTaskAttachment.js';
import { ListTaskComments } from './application/task/ListTaskComments.js';
import { ListTaskCommentsForAgent } from './application/task/ListTaskCommentsForAgent.js';
import { MaybeReopenForClarification } from './application/task/MaybeReopenForClarification.js';
import { HttpTelegramClient } from './infrastructure/telegram/HttpTelegramClient.js';
import { DrizzleTelegramOutboundRepository } from './infrastructure/repositories/DrizzleTelegramOutboundRepository.js';
import { DrizzleTelegramRalphQuestionRepository } from './infrastructure/repositories/DrizzleTelegramRalphQuestionRepository.js';
import { ConnectTelegramAccount } from './application/telegram/ConnectTelegramAccount.js';
import { GetTelegramStatus } from './application/telegram/GetTelegramStatus.js';
import { SendAgentTelegramNotification } from './application/telegram/SendAgentTelegramNotification.js';
import { HandleTelegramWebhook } from './application/telegram/HandleTelegramWebhook.js';
import { BroadcastTelegramNotificationByTask } from './application/telegram/BroadcastTelegramNotificationByTask.js';
import { TelegramPoller } from './application/telegram/TelegramPoller.js';
import { CreateTaskComment } from './application/task/CreateTaskComment.js';
import { UpdateTaskComment } from './application/task/UpdateTaskComment.js';
import { DeleteTaskComment } from './application/task/DeleteTaskComment.js';
import { RequestRalphCancel } from './application/task/RequestRalphCancel.js';
import { RevokeRalphCancel } from './application/task/RevokeRalphCancel.js';
import { AckRalphCancel } from './application/task/AckRalphCancel.js';
import { ListNotifications } from './application/notifications/ListNotifications.js';
import { CountUnreadNotifications } from './application/notifications/CountUnreadNotifications.js';
import { MarkNotificationRead } from './application/notifications/MarkNotificationRead.js';
import { MarkAllNotificationsRead } from './application/notifications/MarkAllNotificationsRead.js';
import { DrizzleSecretsRepository } from './infrastructure/repositories/DrizzleSecretsRepository.js';
import { PutSecret } from './application/secrets/PutSecret.js';
import { GetSecret } from './application/secrets/GetSecret.js';
import { DeleteSecret } from './application/secrets/DeleteSecret.js';
import { ListSecretKeys } from './application/secrets/ListSecretKeys.js';
import { DrizzleAdminRepository } from './infrastructure/repositories/DrizzleAdminRepository.js';
import { ListAllProjects } from './application/admin/ListAllProjects.js';
import { ListAllUsers } from './application/admin/ListAllUsers.js';
import { ListUserProjectsWithDispatcher } from './application/admin/ListUserProjectsWithDispatcher.js';
import { UpdateUserAsAdmin } from './application/admin/UpdateUserAsAdmin.js';
import { DrizzleEmployeeRepository } from './infrastructure/repositories/DrizzleEmployeeRepository.js';
import { DrizzleProjectFinanceRepository } from './infrastructure/repositories/DrizzleProjectFinanceRepository.js';
import { ManageEmployees } from './application/finance/ManageEmployees.js';
import { ManageProjectFinance } from './application/finance/ManageProjectFinance.js';
import { GetProjectFinance } from './application/finance/GetProjectFinance.js';
import { createApp } from './presentation/http.js';
import { config, sessionTtlMs } from './presentation/config.js';

const passwordHasher = new Argon2PasswordHasher();
const now = (): Date => new Date();

const userRepo = new DrizzleUserRepository(db);
const sessionRepo = new DrizzleSessionRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const projectMemberRepo = new DrizzleProjectMemberRepository(db);
const projectInviteRepo = new DrizzleProjectInviteRepository(db);
// Real-time-доставка: хаб + декоратор поверх Drizzle-репозитория. Любое создание
// уведомления автоматически push'ится подписчикам SSE.
const notificationHub = new NotificationHub();
const notificationRepo = new PublishingNotificationRepository(
  new DrizzleNotificationRepository(db),
  notificationHub,
);
// Real-time-события (task/project changed) для live-обновления UI без перезагрузки.
// Транслируются всем участникам проекта по тому же SSE-коннекту, что и уведомления.
const realtimeHub = new RealtimeHub();
const projectEventBroadcaster = new ProjectEventBroadcaster({
  members: projectMemberRepo,
  publisher: realtimeHub,
});
// Best-effort: ошибка резолва участников не должна влиять на основной запрос.
const notifyTaskChanged = (projectId: string): void => {
  void projectEventBroadcaster.broadcast(projectId, 'task_changed').catch(() => {});
};
const notifyProjectChanged = (projectId: string): void => {
  void projectEventBroadcaster.broadcast(projectId, 'project_changed').catch(() => {});
};
// SSE comment_added — для Ralph-диспетчера (мгновенная реакция вместо polling'а).
const notifyCommentAdded = (
  projectId: string,
  taskId: string,
  commentId: string,
  ownerUserId: string,
  actorKind?: 'user' | 'agent' | 'system',
  agentName?: string | null,
): void => {
  void projectEventBroadcaster
    .broadcastCommentAdded(projectId, taskId, commentId, ownerUserId, actorKind, agentName)
    .catch(() => {});
};
// SSE task_status_changed — move и авто-возврат awaiting_clarification → in_progress.
const notifyStatusChanged = (
  projectId: string,
  taskId: string,
  oldStatus: string,
  newStatus: string,
  actorUserId: string,
): void => {
  void projectEventBroadcaster
    .broadcastStatusChanged(projectId, taskId, oldStatus, newStatus, actorUserId)
    .catch(() => {});
};
const githubTokenRepo = new DrizzleGithubTokenRepository(db);

// Email: SMTP если задан SMTP_HOST, иначе логирующая заглушка (dev без почтовика).
const emailSender: EmailSender = process.env['SMTP_HOST']
  ? new SmtpEmailSender({
      host: process.env['SMTP_HOST'],
      port: Number(process.env['SMTP_PORT'] ?? 587),
      user: process.env['SMTP_USER'] ?? '',
      password: process.env['SMTP_PASSWORD'] ?? '',
      from: process.env['SMTP_FROM'] ?? process.env['SMTP_USER'] ?? 'no-reply@projectsflow.ru',
      secure: Number(process.env['SMTP_PORT'] ?? 587) === 465,
      // Строгая проверка cert по умолчанию; SMTP_TLS_REJECT_UNAUTHORIZED=false —
      // для self-hosted MTA с самоподписанным сертификатом.
      rejectUnauthorized: process.env['SMTP_TLS_REJECT_UNAUTHORIZED'] !== 'false',
    })
  : new LoggingEmailSender();
const appBaseUrl =
  process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173';

const githubApi = new FetchGithubApiClient(config.github.clientId);
const deviceFlowStore = new DeviceFlowStore();
const kbRepo = new GithubKbRepository(githubApi);
const kbDocumentRepo = new DrizzleKbDocumentRepository(db);

const secretsRepo = new DrizzleSecretsRepository(db);
const taskRepo = new DrizzleTaskRepository(db);
const taskCommitRepo = new DrizzleTaskCommitRepository(db);
const taskAttachmentRepo = new DrizzleTaskAttachmentRepository(db);
const taskCommentRepo = new DrizzleTaskCommentRepository(db);
const taskDelegationRepo = new DrizzleTaskDelegationRepository(db);
const agentTokenRepo = new DrizzleAgentTokenRepository(db);
const agentJobRepo = new DrizzleAgentJobRepository(db);
const taskSearchRepo = new DrizzleTaskSearchRepository(db);
const projectJoinRequestRepo = new DrizzleProjectJoinRequestRepository(db);
const adminRepo = new DrizzleAdminRepository(db);
const employeeRepo = new DrizzleEmployeeRepository(db);
const projectFinanceRepo = new DrizzleProjectFinanceRepository(db);

const gitTokenDelegationRepo = new DrizzleGitTokenDelegationRepository(db, idGenerator);

// KB-store: единый фасад, выбирающий github↔local-бэкенд по project.kbKind.
// v0.16+: GithubKbBackend получает `delegations`/`projects`/`users` для
// fallback'а на делегированный токен в `resolveEffectiveGithubToken`.
const kbStore = new DispatchingKbStore({
  github: new GithubKbBackend({
    kb: kbRepo,
    tokens: githubTokenRepo,
    projects: projectRepo,
    delegations: gitTokenDelegationRepo,
    users: userRepo,
  }),
  local: new LocalKbBackend({ docs: kbDocumentRepo, idGen: idGenerator }),
});

// In-memory rate-limiter для agent repo-usage / repo-access-requests.
const agentRateLimiter = new InMemoryRateLimiter();
setInterval(() => agentRateLimiter.pruneExpired(), 10 * 60 * 1000).unref();

// Политика «авто-дефолт Ralph-диспетчера для новых проектов»: первый admin
// с активным agent-токеном. Если такого нет — null, проект остаётся в ручном
// режиме. Используется в CreateProject (web + agent flow).
const resolveDefaultDispatcher = (): Promise<string | null> =>
  pickDefaultDispatcherUserId(userRepo, agentTokenRepo);

// Секрет для непрозрачного requestTarget (HMAC). Отдельный env → fallback на vault-ключ.
// ВАЖНО: в prod refuse-to-boot если оба env не заданы — иначе fallback на
// захардкоженый 'dev-repo-access-secret' (виден в исходниках) позволил бы любому
// форджить requestTarget'ы и DDOS'ить notifications.
const envRepoAccessSecret = process.env['REPO_ACCESS_HMAC_SECRET'] ?? process.env['SECRETS_MASTER_KEY'];
if (!envRepoAccessSecret && process.env['NODE_ENV'] === 'production') {
  throw new Error(
    'REPO_ACCESS_HMAC_SECRET (or SECRETS_MASTER_KEY) must be set in production — refusing to start with the dev fallback.',
  );
}
const repoAccessSecret = envRepoAccessSecret ?? 'dev-repo-access-secret';

// Рассылка email-оповещений команде по активности проекта (с учётом пер-участниковых
// настроек и источника team/mcp). Используется роутами fire-and-forget.
const projectNotifier = new ProjectNotificationService({
  members: projectMemberRepo,
  projects: projectRepo,
  tasks: taskRepo,
  email: emailSender,
  appUrl: appBaseUrl,
});

// ===== Telegram multi-user notifications (Phase 1) =====
// Конфиг: см. .env / spec multi-user-telegram-notifications.md. Все поля опциональны —
// без token'а сервис в graceful-режиме: GET /api/me/telegram отвечает connected=false,
// connect-попытки фейлятся при verify (нечем подписывать HMAC), агентский send
// возвращает 'error: no token'. Webhook не регистрируется автоматически.
const telegramBotToken = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
const telegramBotUsername = process.env['TELEGRAM_BOT_USERNAME'] ?? null;
const telegramWebhookSecret = process.env['TELEGRAM_WEBHOOK_SECRET'] ?? null;
const telegramWebhookUrl = process.env['TELEGRAM_WEBHOOK_URL'] ?? null;
// TELEGRAM_API_BASE_URL — опциональный relay (например, CF-worker), если хостинг не
// маршрутизирует api.telegram.org (типично RU-провайдеры: часть подсетей даёт ETIMEDOUT).
// Без env — прямой канал на api.telegram.org.
const telegramApiBaseUrl =
  process.env['TELEGRAM_API_BASE_URL'] ?? 'https://api.telegram.org';
// TELEGRAM_HTTP_PROXY — HTTP(S)-proxy URL (стандарт http://user:pass@host:port) для
// всех исходящих к Telegram. Самый простой способ обойти провайдерскую блокировку.
const telegramHttpProxy = process.env['TELEGRAM_HTTP_PROXY'] || undefined;

const telegramClient = new HttpTelegramClient(
  telegramBotToken,
  telegramApiBaseUrl,
  telegramHttpProxy,
);
const telegramOutboundRepo = new DrizzleTelegramOutboundRepository(db);
const telegramRalphQuestionRepo = new DrizzleTelegramRalphQuestionRepository(db);

const connectTelegramAccount = new ConnectTelegramAccount({
  users: userRepo,
  botToken: telegramBotToken,
  maxAuthAgeSeconds: 86_400,
});
const getTelegramStatus = new GetTelegramStatus({
  users: userRepo,
  botUsername: telegramBotUsername,
});
// Маппинг agent-kind → user pref-toggle. Неизвестные kinds шлются без pref-чека.
// v2: добавлены ralph_answer_accepted/comment_on_my_task/task_blocked + task_done
// перемаплен на statusChange (а не taskDone) по spec multi-user-telegram-...-v2-delta.
const TG_KIND_TO_PREF = {
  comment: 'commentOnMyTask',
  comment_on_my_task: 'commentOnMyTask',
  mention: 'mention',
  status_change: 'statusChange',
  task_done: 'statusChange',
  task_blocked: 'statusChange',
  ralph_question: 'ralphQuestion',
  ralph_question_reminder: 'ralphQuestion',
  ralph_answer: 'ralphAnswer',
  ralph_answer_accepted: 'ralphAnswer',
} as const;
const sendAgentTelegramNotification = new SendAgentTelegramNotification({
  users: userRepo,
  client: telegramClient,
  outbound: telegramOutboundRepo,
  ralphQuestionMessages: telegramRalphQuestionRepo,
  idGen: idGenerator,
  kindToPref: TG_KIND_TO_PREF,
});
// CreateTaskComment + MaybeReopenForClarification используются и в HTTP-роутерах (см. ниже),
// и в HandleTelegramWebhook (reply→ralph-answer ветка). Один экземпляр на оба чтобы не
// дублировать конструкцию и не разъезжаться по поведению.
const createTaskCommentUseCase = new CreateTaskComment({
  projects: projectRepo,
  members: projectMemberRepo,
  tasks: taskRepo,
  comments: taskCommentRepo,
  notifications: notificationRepo,
  idGen: idGenerator,
});
const maybeReopenForClarification = new MaybeReopenForClarification({ tasks: taskRepo });

const handleTelegramWebhook = new HandleTelegramWebhook({
  users: userRepo,
  members: projectMemberRepo,
  tasks: taskRepo,
  client: telegramClient,
  appUrl: appBaseUrl,
  botUsername: telegramBotUsername,
  ralphQuestionMessages: telegramRalphQuestionRepo,
  createComment: createTaskCommentUseCase,
  maybeReopenForClarification,
  notifyTaskChanged,
  notifyCommentAdded,
  notifyStatusChanged,
});
// v2: fan-out по taskId — грузит задачу/members и переиспользует sendAgentTelegramNotification
// per recipient (там уже все gates — link/started/prefs/dedup/audit).
const broadcastTelegramByTask = new BroadcastTelegramNotificationByTask({
  tasks: taskRepo,
  members: projectMemberRepo,
  send: sendAgentTelegramNotification,
});
// Polling-fallback: для хостингов где inbound от Telegram блокируется (типично RU).
// Сам long-poll'ит getUpdates через тот же proxy.
const telegramPoller = new TelegramPoller({
  client: telegramClient,
  handler: handleTelegramWebhook,
});

// Admin-bypass: системный админ (users.is_admin) получает доступ ко всем проектам
// через requireProjectAccess. Кешировать не нужно — getById дешёвый, вызов на access-check.
configureAdminBypass(async (userId) => {
  const u = await userRepo.getById(userId);
  return u?.isAdmin ?? false;
});

// Каталог с binary-аттачами. В dev: ./uploads (рядом с кодом), в prod: задаём
// UPLOADS_DIR в .env (typically /var/www/.../uploads — снаружи tarball'а деплоя,
// чтобы файлы переживали релизы).
import { resolve as resolvePath } from 'node:path';
const uploadsDir = resolvePath(process.env['UPLOADS_DIR'] ?? 'uploads');
const attachmentStorage = new FileSystemAttachmentStorage(uploadsDir);
console.log(`[projectsflow] attachments dir: ${uploadsDir}`);

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB. Любой тип файла (валидация = размер).
const agentTokenHasher = new Sha256AgentTokenHasher();
const agentDeviceCodeStore = new InMemoryAgentDeviceCodeStore();

// Periodic cleanup истёкших pending device-code'ов (10 min TTL → каждые 5 min достаточно).
// Если процесс рестартится — все pending'и теряются, что норм: юзер просто запросит новый.
setInterval(
  () => {
    const pruned = agentDeviceCodeStore.pruneExpired(new Date());
    if (pruned > 0) console.log(`[projectsflow] device-code: pruned ${pruned} expired`);
  },
  5 * 60 * 1000,
).unref();

const authDeps = {
  users: userRepo,
  sessions: sessionRepo,
  passwordHasher,
  idGen: idGenerator,
  sessionTtlMs: sessionTtlMs(),
  now,
};

const { app, devProxyUpgrade } = createApp({
  auth: {
    register: new Register(authDeps),
    login: new Login(authDeps),
    logout: new Logout(sessionRepo),
    getCurrentUser: new GetCurrentUser({ users: userRepo, sessions: sessionRepo, now }),
  },
  user: {
    updateProfile: new UpdateProfile(userRepo),
  },
  projects: {
    listProjects: new ListProjects(projectMemberRepo),
    getProject: new GetProject({ projects: projectRepo, members: projectMemberRepo }),
    createProject: new CreateProject({
      repo: projectRepo,
      members: projectMemberRepo,
      idGen: idGenerator,
      resolveDefaultDispatcher,
    }),
    updateProject: new UpdateProject({ projects: projectRepo, members: projectMemberRepo }),
    deleteProject: new DeleteProject({
      projects: projectRepo,
      members: projectMemberRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    setProjectDispatcher: new SetProjectDispatcher({
      projects: projectRepo,
      members: projectMemberRepo,
      agentTokens: agentTokenRepo,
      users: userRepo,
    }),
    listDispatcherCandidates: new ListDispatcherCandidates({
      projects: projectRepo,
      members: projectMemberRepo,
      agentTokens: agentTokenRepo,
      users: userRepo,
    }),
    setGitTokenDelegation: new SetGitTokenDelegation({
      projects: projectRepo,
      members: projectMemberRepo,
      delegations: gitTokenDelegationRepo,
      githubTokens: githubTokenRepo,
      users: userRepo,
    }),
    listGitTokenAccessLog: new ListGitTokenAccessLog({
      projects: projectRepo,
      delegations: gitTokenDelegationRepo,
    }),
    gitTokenDelegations: gitTokenDelegationRepo,
    users: userRepo,
    githubTokens: githubTokenRepo,
    projects: projectRepo,
    reorderProjects: new ReorderProjects({ members: projectMemberRepo }),
    listProjectCommits: new ListProjectCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    getOrCreateInbox: new GetOrCreateInbox({
      repo: projectRepo,
      members: projectMemberRepo,
      idGen: idGenerator,
    }),
    listMembers: new ListProjectMembers({ projects: projectRepo, members: projectMemberRepo }),
    removeMember: new RemoveProjectMember({ projects: projectRepo, members: projectMemberRepo }),
    updateMemberRole: new UpdateProjectMemberRole({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    transferOwnership: new TransferProjectOwnership({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    createInvite: new CreateProjectInvite({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      randomToken: () => randomBytes(32).toString('hex'),
      now,
      ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 дней (см. spec)
      appUrl: appBaseUrl,
    }),
    listInvites: new ListProjectInvites({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
      now,
    }),
    deleteInvite: new DeleteProjectInvite({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
    }),
    listSharedMembers: new ListSharedMembers(projectMemberRepo),
    checkGitCollision: new CheckGitCollision({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    requestJoin: new RequestProjectJoin({
      projects: projectRepo,
      members: projectMemberRepo,
      joinRequests: projectJoinRequestRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
    }),
    resolveJoinRequest: new ResolveProjectJoinRequest({
      projects: projectRepo,
      members: projectMemberRepo,
      joinRequests: projectJoinRequestRepo,
      now,
    }),
    appUrl: process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173',
    notifyProjectChanged,
    members: projectMemberRepo,
  },
  notifications: {
    list: new ListNotifications({ repo: notificationRepo }),
    countUnread: new CountUnreadNotifications({ repo: notificationRepo }),
    markRead: new MarkNotificationRead({ repo: notificationRepo, now }),
    markAllRead: new MarkAllNotificationsRead({ repo: notificationRepo, now }),
    subscribe: (userId, fn) => notificationHub.subscribe(userId, fn),
    subscribeRealtime: (userId, fn) => realtimeHub.subscribe(userId, fn),
    projectNotifier,
  },
  invites: {
    getByToken: new GetInviteByToken({
      invites: projectInviteRepo,
      projects: projectRepo,
      users: userRepo,
      now,
    }),
    accept: new AcceptProjectInvite({
      invites: projectInviteRepo,
      members: projectMemberRepo,
      now,
    }),
  },
  search: {
    searchTasks: new SearchTasks({ search: taskSearchRepo }),
  },
  telegram: {
    connect: connectTelegramAccount,
    status: getTelegramStatus,
    handler: handleTelegramWebhook,
    webhookSecret: telegramWebhookSecret,
    users: userRepo,
  },
  admin: {
    listAllProjects: new ListAllProjects(adminRepo),
    listAllUsers: new ListAllUsers(adminRepo),
    updateUser: new UpdateUserAsAdmin(adminRepo),
    listUserProjectsWithDispatcher: new ListUserProjectsWithDispatcher({
      members: projectMemberRepo,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
  },
  finance: {
    manageEmployees: new ManageEmployees({
      employees: employeeRepo,
      finance: projectFinanceRepo,
      idGen: idGenerator,
      now,
    }),
    manageProjectFinance: new ManageProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      idGen: idGenerator,
      now,
    }),
    getProjectFinance: new GetProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      now,
    }),
  },
  secrets: {
    putSecret: new PutSecret({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
    getSecret: new GetSecret({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
    deleteSecret: new DeleteSecret({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
    listSecretKeys: new ListSecretKeys({ projects: projectRepo, members: projectMemberRepo, repo: secretsRepo }),
  },
  kb: {
    initKbRepo: new InitKbRepo({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    connectKbRepo: new ConnectKbRepo({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    disconnectKb: new DisconnectKb({ projects: projectRepo, members: projectMemberRepo }),
    initLocalKb: new InitLocalKb({ projects: projectRepo, members: projectMemberRepo }),
    listKbDocuments: new ListKbDocuments({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    getKbDocument: new GetKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    writeKbDocument: new WriteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    deleteKbDocument: new DeleteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    bulkCreateCredential: new BulkCreateCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
      secrets: secretsRepo,
    }),
  },
  tasks: {
    listTasks: new ListTasks({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      attachments: taskAttachmentRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
    }),
    createTask: new CreateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
    }),
    updateTask: new UpdateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    moveTask: new MoveTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    deleteTask: new DeleteTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    linkCommit: new LinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    unlinkCommit: new UnlinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
    }),
    listTaskCommits: new ListTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
    }),
    syncTaskCommits: new SyncTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    uploadAttachment: new UploadTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
      idGen: idGenerator,
      maxBytes: MAX_ATTACHMENT_BYTES,
    }),
    deleteAttachment: new DeleteTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    listAttachments: new ListTaskAttachments({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
    }),
    getAttachment: new GetTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    listComments: new ListTaskComments({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      attachments: taskAttachmentRepo,
    }),
    createComment: createTaskCommentUseCase,
    updateComment: new UpdateTaskComment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    deleteComment: new DeleteTaskComment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    requestRalphCancel: new RequestRalphCancel({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    revokeRalphCancel: new RevokeRalphCancel({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      users: userRepo,
    }),
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    agentJobs: agentJobRepo,
    notifyTaskChanged,
    notifyCommentAdded,
    notifyStatusChanged,
    // tasks repo — нужен роуту для чтения oldStatus до move'а (SSE task_status_changed).
    tasks: taskRepo,
    maybeReopenForClarification,
  },
  agent: {
    createAgentToken: new CreateAgentToken({
      tokens: agentTokenRepo,
      hasher: agentTokenHasher,
      idGen: idGenerator,
      // 32-byte (256-bit) entropy — крипто-случайный токен hex 64 char'а.
      randomToken: () => randomBytes(32).toString('hex'),
    }),
    listAgentTokens: new ListAgentTokens({ tokens: agentTokenRepo }),
    revokeAgentToken: new RevokeAgentToken({ tokens: agentTokenRepo, projects: projectRepo }),
    authenticateAgentToken: new AuthenticateAgentToken({
      tokens: agentTokenRepo,
      hasher: agentTokenHasher,
      users: userRepo,
    }),
    getAgentCredential: new GetAgentCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
      secrets: secretsRepo,
    }),
    getAgentTask: new GetAgentTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      comments: taskCommentRepo,
      storage: attachmentStorage,
    }),
    createAgentCredential: new CreateAgentCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
      secrets: secretsRepo,
    }),
    // Переиспользуем существующие use-cases для agent-эндпоинтов
    listProjects: new ListProjects(projectMemberRepo),
    createProjectWithGit: new CreateProjectWithGit({
      createProject: new CreateProject({
        repo: projectRepo,
        members: projectMemberRepo,
        idGen: idGenerator,
        resolveDefaultDispatcher,
      }),
      updateProject: new UpdateProject({ projects: projectRepo, members: projectMemberRepo }),
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    updateProject: new UpdateProject({ projects: projectRepo, members: projectMemberRepo }),
    listUserRepos: new ListUserRepos({ tokens: githubTokenRepo, api: githubApi }),
    listKbDocuments: new ListKbDocuments({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    listTasks: new ListTasks({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      attachments: taskAttachmentRepo,
      comments: taskCommentRepo,
      delegations: taskDelegationRepo,
    }),
    createTask: new CreateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      delegations: taskDelegationRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
    }),
    createComment: createTaskCommentUseCase,
    // Чтение комментариев задачи (Ralph F11 polling): фильтры since/limit/marker
    // + ownerDisplayName. Не использует ListTaskComments из tasks-блока (та тянет
    // attachments-батч лишний раз).
    listTaskCommentsForAgent: new ListTaskCommentsForAgent({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      users: userRepo,
    }),
    moveTask: new MoveTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    linkCommit: new LinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    writeKbDocument: new WriteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    requestDeviceCode: new RequestAgentDeviceCode({
      store: agentDeviceCodeStore,
      now,
      ttlMs: 10 * 60 * 1000, // 10 min
      intervalSec: 3,
      // verificationBaseUrl: APP_URL (без '/api'), на проде https://projectsflow.ru.
      // Используем env-vars напрямую — конфиг-объект тут не хочется захламлять,
      // и значение нужно один раз на старте.
      verificationBaseUrl:
        process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173',
    }),
    approveDeviceCode: new ApproveAgentDeviceCode({
      store: agentDeviceCodeStore,
      createAgentToken: new CreateAgentToken({
        tokens: agentTokenRepo,
        hasher: agentTokenHasher,
        idGen: idGenerator,
        randomToken: () => randomBytes(32).toString('hex'),
      }),
      now,
    }),
    pollDeviceToken: new PollAgentDeviceToken({ store: agentDeviceCodeStore, now }),
    getDeviceCodeInfo: new GetAgentDeviceCodeInfo({ store: agentDeviceCodeStore, now }),
    enqueueAgentJob: new EnqueueAgentJob({
      members: projectMemberRepo,
      tasks: taskRepo,
      agentJobs: agentJobRepo,
    }),
    cancelAgentJob: new CancelAgentJob({
      members: projectMemberRepo,
      agentJobs: agentJobRepo,
    }),
    listAgentJobsForProject: new ListAgentJobsForProject({
      members: projectMemberRepo,
      agentJobs: agentJobRepo,
    }),
    listPendingAgentJobs: new ListPendingAgentJobs({ agentJobs: agentJobRepo }),
    claimAgentJob: new ClaimAgentJob({ members: projectMemberRepo, agentJobs: agentJobRepo }),
    completeAgentJob: new CompleteAgentJob({ members: projectMemberRepo, agentJobs: agentJobRepo }),
    ackRalphCancel: new AckRalphCancel({ tasks: taskRepo }),
    agentJobs: agentJobRepo,
    checkRepoUsage: new CheckRepoUsage({
      projects: projectRepo,
      members: projectMemberRepo,
      tokenSecret: repoAccessSecret,
    }),
    requestRepoAccess: new RequestRepoAccess({
      projects: projectRepo,
      members: projectMemberRepo,
      joinRequests: projectJoinRequestRepo,
      users: userRepo,
      notifications: notificationRepo,
      email: emailSender,
      idGen: idGenerator,
      appUrl: appBaseUrl,
      tokenSecret: repoAccessSecret,
    }),
    initLocalKb: new InitLocalKb({ projects: projectRepo, members: projectMemberRepo }),
    // Расширенный набор agent-операций (MCP 0.10) — те же use-case'ы, что у web-API.
    updateTask: new UpdateTask({ projects: projectRepo, members: projectMemberRepo, tasks: taskRepo }),
    deleteTask: new DeleteTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    listTaskCommits: new ListTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
    }),
    syncTaskCommits: new SyncTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
      delegations: gitTokenDelegationRepo,
      users: userRepo,
    }),
    searchTasks: new SearchTasks({ search: taskSearchRepo }),
    getProject: new GetProject({ projects: projectRepo, members: projectMemberRepo }),
    listProjectMembers: new ListProjectMembers({ projects: projectRepo, members: projectMemberRepo }),
    getKbDocument: new GetKbDocument({ projects: projectRepo, members: projectMemberRepo, kb: kbStore }),
    deleteKbDocument: new DeleteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      kb: kbStore,
    }),
    getProjectFinance: new GetProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      now,
    }),
    manageProjectFinance: new ManageProjectFinance({
      projects: projectRepo,
      members: projectMemberRepo,
      employees: employeeRepo,
      finance: projectFinanceRepo,
      idGen: idGenerator,
      now,
    }),
    getMyAccount: new GetMyAccount({
      users: userRepo,
      githubTokens: githubTokenRepo,
      agentTokens: agentTokenRepo,
    }),
    deleteProject: new DeleteProject({
      projects: projectRepo,
      members: projectMemberRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    listMyDispatchedProjects: new ListMyDispatchedProjects({
      projects: projectRepo,
      tasks: taskRepo,
      agentJobs: agentJobRepo,
    }),
    setProjectDispatcher: new SetProjectDispatcher({
      projects: projectRepo,
      members: projectMemberRepo,
      agentTokens: agentTokenRepo,
      users: userRepo,
    }),
    getDelegatedGitToken: new GetDelegatedGitToken({
      projects: projectRepo,
      delegations: gitTokenDelegationRepo,
      githubTokens: githubTokenRepo,
      users: userRepo,
    }),
    rateLimiter: agentRateLimiter,
    sendTelegramNotification: sendAgentTelegramNotification,
    broadcastTelegramByTask,
    projects: projectRepo,
  },
  github: {
    startDeviceFlow: new StartDeviceFlow({
      api: githubApi,
      storeDeviceCode: (userId, deviceCode, interval, expiresAt) =>
        deviceFlowStore.store(userId, deviceCode, interval, expiresAt),
      now,
    }),
    pollDeviceFlow: new PollDeviceFlow({
      api: githubApi,
      tokens: githubTokenRepo,
      getDeviceCode: (userId) => deviceFlowStore.get(userId),
      updateInterval: (userId, ms) => deviceFlowStore.setInterval(userId, ms),
      clearDeviceCode: (userId) => deviceFlowStore.clear(userId),
      now,
    }),
    disconnectGithub: new DisconnectGithub(githubTokenRepo),
    listUserRepos: new ListUserRepos({ tokens: githubTokenRepo, api: githubApi }),
    tokens: githubTokenRepo,
  },
});

const server = app.listen(config.port, () => {
  console.log(
    `[projectsflow] listening on http://127.0.0.1:${config.port} (${config.nodeEnv})`,
  );
  console.log(
    `[projectsflow] github integration: ${config.github.clientId ? 'enabled' : 'DISABLED (no GITHUB_CLIENT_ID)'}`,
  );
  // Telegram mode: TELEGRAM_MODE = 'webhook' | 'polling' | 'auto' (default).
  // auto = webhook если задан URL+secret, иначе polling. Полезно для хостингов где
  // inbound от Telegram блокируется — там webhook никогда не доставит апдейты.
  const tgMode = (process.env['TELEGRAM_MODE'] || 'auto').toLowerCase();
  if (!telegramBotToken) {
    console.log('[projectsflow] telegram bot: DISABLED (missing TELEGRAM_BOT_TOKEN)');
  } else if (
    tgMode === 'webhook' ||
    (tgMode === 'auto' && telegramWebhookUrl && telegramWebhookSecret)
  ) {
    if (!telegramWebhookUrl || !telegramWebhookSecret) {
      console.warn(
        '[projectsflow] telegram: webhook mode requested, но TELEGRAM_WEBHOOK_URL/SECRET пусты — fallback на polling',
      );
      void telegramPoller.start().catch((err) => console.warn('[tg-poller] start failed:', err));
    } else {
      telegramClient
        .setWebhook(telegramWebhookUrl, telegramWebhookSecret)
        .then(() => console.log(`[projectsflow] telegram webhook: ${telegramWebhookUrl}`))
        .catch((err) => console.warn('[projectsflow] telegram setWebhook failed:', err));
    }
  } else if (tgMode === 'polling' || tgMode === 'auto') {
    void telegramPoller.start().catch((err) => console.warn('[tg-poller] start failed:', err));
  } else {
    console.warn(`[projectsflow] telegram: unknown TELEGRAM_MODE='${tgMode}'`);
  }
});

// HMR-WebSocket: Vite-клиент конектится через тот же Express'овый origin.
// Без этого hot-reload не работает через dev-gateway.
if (devProxyUpgrade) {
  server.on('upgrade', devProxyUpgrade);
  console.log('[projectsflow] dev gateway: proxying SPA + HMR to Vite');
}

// Грациозный shutdown — закрываем pool, иначе процесс висит. Также останавливаем
// TG-поллер (он сам завершит long-poll по timeout от Telegram).
const shutdown = (signal: string): void => {
  console.log(`[projectsflow] received ${signal}, shutting down`);
  void telegramPoller.stop();
  server.close(() => {
    pool.end().then(() => {
      console.log('[projectsflow] pool closed, bye');
      process.exit(0);
    });
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
