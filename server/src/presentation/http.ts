import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request } from 'express';
import cookieParser from 'cookie-parser';
import {
  createProxyMiddleware,
  type RequestHandler as ProxyRequestHandler,
} from 'http-proxy-middleware';
import type { GetCurrentUser } from '../application/auth/GetCurrentUser.js';
import type { Register } from '../application/auth/Register.js';
import type { Login } from '../application/auth/Login.js';
import type { Logout } from '../application/auth/Logout.js';
import type { UpdateProfile } from '../application/user/UpdateProfile.js';
import type { ListProjects } from '../application/project/ListProjects.js';
import type { GetProject } from '../application/project/GetProject.js';
import type { CreateProject } from '../application/project/CreateProject.js';
import type { UpdateProject } from '../application/project/UpdateProject.js';
import type { DeleteProject } from '../application/project/DeleteProject.js';
import type { SetProjectDispatcher } from '../application/project/SetProjectDispatcher.js';
import type { ListDispatcherCandidates } from '../application/project/ListDispatcherCandidates.js';
import type { ListMyDispatchedProjects } from '../application/agent/ListMyDispatchedProjects.js';
import type { SetGitTokenDelegation } from '../application/project/SetGitTokenDelegation.js';
import type { ListGitTokenAccessLog } from '../application/project/ListGitTokenAccessLog.js';
import type { GetDelegatedGitToken } from '../application/project/GetDelegatedGitToken.js';
import type { GitTokenDelegationRepository } from '../application/project/GitTokenDelegationRepository.js';
import type { UserRepository } from '../application/user/UserRepository.js';
import type { ReorderProjects } from '../application/project/ReorderProjects.js';
import type { ToggleProjectFavorite } from '../application/project/ToggleProjectFavorite.js';
import type { ReorderFavoriteProjects } from '../application/project/ReorderFavoriteProjects.js';
import type { CreateProjectWithGit } from '../application/project/CreateProjectWithGit.js';
import type { GetOrCreateInbox } from '../application/project/GetOrCreateInbox.js';
import type { ListProjectMembers } from '../application/project/ListProjectMembers.js';
import type { RemoveProjectMember } from '../application/project/RemoveProjectMember.js';
import type { UpdateProjectMemberRole } from '../application/project/UpdateProjectMemberRole.js';
import type { TransferProjectOwnership } from '../application/project/TransferProjectOwnership.js';
import type { CreateProjectInvite } from '../application/project/CreateProjectInvite.js';
import type { ListProjectInvites } from '../application/project/ListProjectInvites.js';
import type { ListSharedMembers } from '../application/project/ListSharedMembers.js';
import type { DeleteProjectInvite } from '../application/project/DeleteProjectInvite.js';
import type { CheckGitCollision } from '../application/project/CheckGitCollision.js';
import type { RequestProjectJoin } from '../application/project/RequestProjectJoin.js';
import type { ResolveProjectJoinRequest } from '../application/project/ResolveProjectJoinRequest.js';
import type { GetInviteByToken } from '../application/project/GetInviteByToken.js';
import type { AcceptProjectInvite } from '../application/project/AcceptProjectInvite.js';
import type { ListProjectCommits } from '../application/github/ListProjectCommits.js';
import type { StartDeviceFlow } from '../application/github/StartDeviceFlow.js';
import type { PollDeviceFlow } from '../application/github/PollDeviceFlow.js';
import type { DisconnectGithub } from '../application/github/DisconnectGithub.js';
import type { ListUserRepos } from '../application/github/ListUserRepos.js';
import type { GithubTokenRepository } from '../application/github/GithubTokenRepository.js';
import type { ProjectRepository } from '../application/project/ProjectRepository.js';
import type { PutSecret } from '../application/secrets/PutSecret.js';
import type { GetSecret } from '../application/secrets/GetSecret.js';
import type { DeleteSecret } from '../application/secrets/DeleteSecret.js';
import type { ListSecretKeys } from '../application/secrets/ListSecretKeys.js';
import type { InitKbRepo } from '../application/kb/InitKbRepo.js';
import type { InitLocalKb } from '../application/kb/InitLocalKb.js';
import type { CheckRepoUsage } from '../application/agent/CheckRepoUsage.js';
import type { RequestRepoAccess } from '../application/agent/RequestRepoAccess.js';
import type { GetMyAccount } from '../application/agent/GetMyAccount.js';
import type { InMemoryRateLimiter } from '../infrastructure/ratelimit/InMemoryRateLimiter.js';
import type { ConnectKbRepo } from '../application/kb/ConnectKbRepo.js';
import type { DisconnectKb } from '../application/kb/DisconnectKb.js';
import type { ListKbDocuments } from '../application/kb/ListKbDocuments.js';
import type { GetKbDocument } from '../application/kb/GetKbDocument.js';
import type { WriteKbDocument } from '../application/kb/WriteKbDocument.js';
import type { DeleteKbDocument } from '../application/kb/DeleteKbDocument.js';
import type { BulkCreateCredential } from '../application/kb/BulkCreateCredential.js';
import type { ListTasks } from '../application/task/ListTasks.js';
import type { SearchTasks } from '../application/task/SearchTasks.js';
import type { CreateTask } from '../application/task/CreateTask.js';
import type { UpdateTask } from '../application/task/UpdateTask.js';
import type { MoveTask } from '../application/task/MoveTask.js';
import type { DeleteTask } from '../application/task/DeleteTask.js';
import type { LinkCommit } from '../application/task/LinkCommit.js';
import type { UnlinkCommit } from '../application/task/UnlinkCommit.js';
import type { ListTaskCommits } from '../application/task/ListTaskCommits.js';
import type { SyncTaskCommits } from '../application/task/SyncTaskCommits.js';
import type { UploadTaskAttachment } from '../application/task/UploadTaskAttachment.js';
import type { DeleteTaskAttachment } from '../application/task/DeleteTaskAttachment.js';
import type { ListTaskAttachments } from '../application/task/ListTaskAttachments.js';
import type { GetTaskAttachment } from '../application/task/GetTaskAttachment.js';
import type { ListTaskComments } from '../application/task/ListTaskComments.js';
import type { ListTaskCommentsForAgent } from '../application/task/ListTaskCommentsForAgent.js';
import type { MaybeReopenForClarification } from '../application/task/MaybeReopenForClarification.js';
import type { TaskRepository } from '../application/task/TaskRepository.js';
import type { ConnectTelegramAccount } from '../application/telegram/ConnectTelegramAccount.js';
import type { GetTelegramStatus } from '../application/telegram/GetTelegramStatus.js';
import type { HandleTelegramWebhook } from '../application/telegram/HandleTelegramWebhook.js';
import type { SendAgentTelegramNotification } from '../application/telegram/SendAgentTelegramNotification.js';
import type { BroadcastTelegramNotificationByTask } from '../application/telegram/BroadcastTelegramNotificationByTask.js';
import type { CreateTaskComment } from '../application/task/CreateTaskComment.js';
import type { UpdateTaskComment } from '../application/task/UpdateTaskComment.js';
import type { DeleteTaskComment } from '../application/task/DeleteTaskComment.js';
import type { RequestRalphCancel } from '../application/task/RequestRalphCancel.js';
import type { RevokeRalphCancel } from '../application/task/RevokeRalphCancel.js';
import type { AcceptTaskDelegation } from '../application/task/AcceptTaskDelegation.js';
import type { DeclineTaskDelegation } from '../application/task/DeclineTaskDelegation.js';
import type { WithdrawTaskDelegation } from '../application/task/WithdrawTaskDelegation.js';
import type { ListMyPendingDelegations } from '../application/task/ListMyPendingDelegations.js';
import type { ListTasksAssignedToMe } from '../application/task/ListTasksAssignedToMe.js';
import type { AssignInboxTaskToProject } from '../application/task/AssignInboxTaskToProject.js';
import type { DelegateExistingTask } from '../application/task/DelegateExistingTask.js';
import type { ListNotifications } from '../application/notifications/ListNotifications.js';
import type { CountUnreadNotifications } from '../application/notifications/CountUnreadNotifications.js';
import type { MarkNotificationRead } from '../application/notifications/MarkNotificationRead.js';
import type { MarkAllNotificationsRead } from '../application/notifications/MarkAllNotificationsRead.js';
import type { Notification as NotificationEntity } from '../domain/notifications/Notification.js';
import type { RealtimeEvent } from '../domain/realtime/RealtimeEvent.js';
import type { ProjectNotificationService } from '../application/notifications/ProjectNotificationService.js';
import type { DispatchCommentNotifications } from '../application/notifications/DispatchCommentNotifications.js';
import type { GetCommentNotifications } from '../application/task/GetCommentNotifications.js';
import type { ListAllProjects } from '../application/admin/ListAllProjects.js';
import type { ListAllUsers } from '../application/admin/ListAllUsers.js';
import type { ListUserProjectsWithDispatcher } from '../application/admin/ListUserProjectsWithDispatcher.js';
import type { UpdateUserAsAdmin } from '../application/admin/UpdateUserAsAdmin.js';
import type { ManageEmployees } from '../application/finance/ManageEmployees.js';
import type { ManageProjectFinance } from '../application/finance/ManageProjectFinance.js';
import type { GetProjectFinance } from '../application/finance/GetProjectFinance.js';
import type { CreateAgentToken } from '../application/agent/CreateAgentToken.js';
import type { ListAgentTokens } from '../application/agent/ListAgentTokens.js';
import type { RevokeAgentToken } from '../application/agent/RevokeAgentToken.js';
import type { AuthenticateAgentToken } from '../application/agent/AuthenticateAgentToken.js';
import type { GetAgentCredential } from '../application/agent/GetAgentCredential.js';
import type { GetAgentTask } from '../application/agent/GetAgentTask.js';
import type { CreateAgentCredential } from '../application/agent/CreateAgentCredential.js';
import type { RequestAgentDeviceCode } from '../application/agent/RequestAgentDeviceCode.js';
import type { ApproveAgentDeviceCode } from '../application/agent/ApproveAgentDeviceCode.js';
import type { PollAgentDeviceToken } from '../application/agent/PollAgentDeviceToken.js';
import type { GetAgentDeviceCodeInfo } from '../application/agent/GetAgentDeviceCodeInfo.js';
import type { EnqueueAiPromptJob } from '../application/ai-prompt/EnqueueAiPromptJob.js';
import type { WaitForAiPromptJob } from '../application/ai-prompt/WaitForAiPromptJob.js';
import type { ListPendingAiPromptJobs } from '../application/ai-prompt/ListPendingAiPromptJobs.js';
import type { ClaimAiPromptJob } from '../application/ai-prompt/ClaimAiPromptJob.js';
import type { CompleteAiPromptJob } from '../application/ai-prompt/CompleteAiPromptJob.js';
import type { AckRalphCancel } from '../application/task/AckRalphCancel.js';
import type { ProjectMemberRepository } from '../application/project/ProjectMemberRepository.js';
import { sessionFromCookie } from './middleware/sessionFromCookie.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './auth/routes.js';
import { projectsRouter } from './projects/routes.js';
import { githubRouter } from './integrations/github/routes.js';
import { secretsRouter } from './secrets/routes.js';
import { kbRouter } from './kb/routes.js';
import { tasksRouter } from './tasks/routes.js';
import { searchRouter } from './search/routes.js';
import type { EmailSender } from '../application/notifications/EmailSender.js';
import { adminRouter } from './admin/routes.js';
import { employeesRouter } from './finance/employeeRoutes.js';
import { financeRouter } from './finance/routes.js';
import { attachmentBinaryRouter } from './tasks/attachmentBinaryRoutes.js';
import { inboxRouter } from './inbox/routes.js';
import { meTelegramRouter } from './me/telegramRoutes.js';
import { meNotificationPrefsRouter } from './me/notificationPrefsRoutes.js';
import { meKanbanColorsRouter } from './me/kanbanColorsRoutes.js';
import { sharedMembersRouter } from './me/sharedMembersRoutes.js';
import { telegramWebhookRouter } from './telegram/webhookRoutes.js';
import { invitesRouter } from './invites/routes.js';
import { delegationsRouter } from './delegations/routes.js';
import { notificationsRouter } from './notifications/routes.js';
import { agentTokensRouter } from './agent/tokensRoutes.js';
import { agentApiRouter } from './agent/apiRoutes.js';
import { fileSyncRouter } from './file-sync/routes.js';
import type { FileSyncService } from '../application/file-sync/FileSyncService.js';
import { liveAgentRouter } from './live/agentRoutes.js';
import { liveUserRouter } from './live/routes.js';
import type { LiveService } from '../application/live/LiveService.js';
import type { LiveEventHub } from '../infrastructure/realtime/LiveEventHub.js';
import { agentDeviceRouter } from './agent/deviceRoutes.js';
import { buildAiPromptRouter } from './ai-prompt/routes.js';
import { buildAutomationRouter } from './automation/routes.js';
import type { GetAutomationConfig } from '../application/automation/GetAutomationConfig.js';
import type { SaveAutomationConfig } from '../application/automation/SaveAutomationConfig.js';
import type { GetAutomationForDispatcher } from '../application/automation/GetAutomationForDispatcher.js';
import type { RecordAutomationTask } from '../application/automation/RecordAutomationTask.js';
import { monitoringRouter } from './monitoring/routes.js';
import type { ListServers } from '../application/monitoring/ListServers.js';
import type { ManageServers } from '../application/monitoring/ManageServers.js';
import type { MonitoringQueries } from '../application/monitoring/MonitoringQueries.js';
import type { IngestAgentSnapshot } from '../application/monitoring/IngestAgentSnapshot.js';
import type { ListMonitoredServers } from '../application/monitoring/ListMonitoredServers.js';
import './types.js'; // глобальное расширение Express.Request

type AppDeps = {
  readonly auth: {
    readonly register: Register;
    readonly login: Login;
    readonly logout: Logout;
    readonly getCurrentUser: GetCurrentUser;
  };
  readonly user: {
    readonly updateProfile: UpdateProfile;
  };
  readonly fileSync: {
    readonly service: FileSyncService;
    readonly maxBlobBytes: number;
  };
  readonly live: {
    readonly service: LiveService;
    readonly liveEventHub: LiveEventHub;
  };
  readonly projects: {
    readonly listProjects: ListProjects;
    readonly getProject: GetProject;
    readonly createProject: CreateProject;
    readonly updateProject: UpdateProject;
    readonly deleteProject: DeleteProject;
    readonly setProjectDispatcher: SetProjectDispatcher;
    readonly listDispatcherCandidates: ListDispatcherCandidates;
    readonly setGitTokenDelegation: SetGitTokenDelegation;
    readonly listGitTokenAccessLog: ListGitTokenAccessLog;
    readonly gitTokenDelegations: GitTokenDelegationRepository;
    // UserRepository нужен для резолва displayName юзеров в access-log'е и
    // в `all`-блоке git-token-delegation.
    readonly users: UserRepository;
    // GithubTokenRepository — для резолва github-login'а каждого члена в UI
    // `all`-блока (owner видит «у кого подключён GH»).
    readonly githubTokens: GithubTokenRepository;
    // ProjectRepository.getById — нужен прямой lookup в GET-роуте делегации
    // (без обёртки use-case'а; чтение public-полей).
    readonly projects: ProjectRepository;
    readonly reorderProjects: ReorderProjects;
    readonly toggleProjectFavorite: ToggleProjectFavorite;
    readonly reorderFavoriteProjects: ReorderFavoriteProjects;
    readonly listProjectCommits: ListProjectCommits;
    readonly getOrCreateInbox: GetOrCreateInbox;
    readonly listMembers: ListProjectMembers;
    readonly removeMember: RemoveProjectMember;
    readonly updateMemberRole: UpdateProjectMemberRole;
    readonly transferOwnership: TransferProjectOwnership;
    readonly createInvite: CreateProjectInvite;
    readonly listInvites: ListProjectInvites;
    readonly deleteInvite: DeleteProjectInvite;
    readonly listSharedMembers: ListSharedMembers;
    readonly checkGitCollision: CheckGitCollision;
    readonly requestJoin: RequestProjectJoin;
    readonly resolveJoinRequest: ResolveProjectJoinRequest;
    readonly appUrl: string;
    readonly notifyProjectChanged: (projectId: string) => void;
    readonly members: ProjectMemberRepository;
  };
  readonly invites: {
    readonly getByToken: GetInviteByToken;
    readonly accept: AcceptProjectInvite;
  };
  readonly search: {
    readonly searchTasks: SearchTasks;
  };
  readonly telegram: {
    readonly connect: ConnectTelegramAccount;
    readonly status: GetTelegramStatus;
    readonly handler: HandleTelegramWebhook;
    readonly webhookSecret: string | null;
    readonly users: UserRepository;
  };
  readonly admin: {
    readonly listAllProjects: ListAllProjects;
    readonly listAllUsers: ListAllUsers;
    readonly updateUser: UpdateUserAsAdmin;
    readonly listUserProjectsWithDispatcher: ListUserProjectsWithDispatcher;
    readonly emailSender: EmailSender;
  };
  readonly finance: {
    readonly manageEmployees: ManageEmployees;
    readonly manageProjectFinance: ManageProjectFinance;
    readonly getProjectFinance: GetProjectFinance;
  };
  readonly notifications: {
    readonly list: ListNotifications;
    readonly countUnread: CountUnreadNotifications;
    readonly markRead: MarkNotificationRead;
    readonly markAllRead: MarkAllNotificationsRead;
    readonly subscribe: (userId: string, fn: (n: NotificationEntity) => void) => () => void;
    readonly subscribeRealtime: (
      userId: string,
      fn: (e: RealtimeEvent) => void,
    ) => () => void;
    readonly projectNotifier: ProjectNotificationService;
  };
  readonly github: {
    readonly startDeviceFlow: StartDeviceFlow;
    readonly pollDeviceFlow: PollDeviceFlow;
    readonly disconnectGithub: DisconnectGithub;
    readonly listUserRepos: ListUserRepos;
    readonly tokens: GithubTokenRepository;
  };
  readonly secrets: {
    readonly putSecret: PutSecret;
    readonly getSecret: GetSecret;
    readonly deleteSecret: DeleteSecret;
    readonly listSecretKeys: ListSecretKeys;
  };
  readonly monitoring: {
    readonly listServers: ListServers;
    readonly manageServers: ManageServers;
    readonly queries: MonitoringQueries;
  };
  readonly kb: {
    readonly initKbRepo: InitKbRepo;
    readonly connectKbRepo: ConnectKbRepo;
    readonly disconnectKb: DisconnectKb;
    readonly initLocalKb: InitLocalKb;
    readonly listKbDocuments: ListKbDocuments;
    readonly getKbDocument: GetKbDocument;
    readonly writeKbDocument: WriteKbDocument;
    readonly deleteKbDocument: DeleteKbDocument;
    readonly bulkCreateCredential: BulkCreateCredential;
  };
  readonly tasks: {
    readonly listTasks: ListTasks;
    readonly createTask: CreateTask;
    readonly updateTask: UpdateTask;
    readonly moveTask: MoveTask;
    readonly deleteTask: DeleteTask;
    readonly linkCommit: LinkCommit;
    readonly unlinkCommit: UnlinkCommit;
    readonly listTaskCommits: ListTaskCommits;
    readonly syncTaskCommits: SyncTaskCommits;
    readonly uploadAttachment: UploadTaskAttachment;
    readonly deleteAttachment: DeleteTaskAttachment;
    readonly listAttachments: ListTaskAttachments;
    readonly getAttachment: GetTaskAttachment;
    readonly listComments: ListTaskComments;
    readonly createComment: CreateTaskComment;
    readonly updateComment: UpdateTaskComment;
    readonly deleteComment: DeleteTaskComment;
    readonly requestRalphCancel: RequestRalphCancel;
    readonly revokeRalphCancel: RevokeRalphCancel;
    readonly maxAttachmentBytes: number;
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
    readonly tasks: TaskRepository;
    readonly maybeReopenForClarification: MaybeReopenForClarification;
    readonly broadcastTelegram: BroadcastTelegramNotificationByTask;
    readonly dispatchCommentNotifications: DispatchCommentNotifications;
    readonly getCommentNotifications: GetCommentNotifications;
    readonly projectRepo: ProjectRepository;
  };
  readonly delegations: {
    readonly accept: AcceptTaskDelegation;
    readonly decline: DeclineTaskDelegation;
    readonly withdraw: WithdrawTaskDelegation;
    readonly listPending: ListMyPendingDelegations;
    readonly listAssignedToMe: ListTasksAssignedToMe;
    readonly assignToProject: AssignInboxTaskToProject;
    readonly delegateExisting: DelegateExistingTask;
  };
  readonly agent: {
    readonly createAgentToken: CreateAgentToken;
    readonly listAgentTokens: ListAgentTokens;
    readonly revokeAgentToken: RevokeAgentToken;
    readonly authenticateAgentToken: AuthenticateAgentToken;
    readonly getAgentCredential: GetAgentCredential;
    readonly getAgentTask: GetAgentTask;
    readonly createAgentCredential: CreateAgentCredential;
    readonly requestDeviceCode: RequestAgentDeviceCode;
    readonly approveDeviceCode: ApproveAgentDeviceCode;
    readonly pollDeviceToken: PollAgentDeviceToken;
    readonly getDeviceCodeInfo: GetAgentDeviceCodeInfo;
    // Переиспользуемые порты для agent API
    readonly listProjects: ListProjects;
    readonly createProjectWithGit: CreateProjectWithGit;
    readonly updateProject: UpdateProject;
    readonly listUserRepos: ListUserRepos;
    readonly listKbDocuments: ListKbDocuments;
    readonly listTasks: ListTasks;
    readonly createTask: CreateTask;
    readonly createComment: CreateTaskComment;
    readonly listTaskCommentsForAgent: ListTaskCommentsForAgent;
    readonly moveTask: MoveTask;
    readonly linkCommit: LinkCommit;
    readonly writeKbDocument: WriteKbDocument;
    // AI prompt-improvement (см. spec 2026-05-28-ai-prompt-improvement-design.md)
    readonly enqueueAiPromptJob: EnqueueAiPromptJob;
    readonly waitForAiPromptJob: WaitForAiPromptJob;
    readonly listPendingAiPromptJobs: ListPendingAiPromptJobs;
    readonly claimAiPromptJob: ClaimAiPromptJob;
    readonly completeAiPromptJob: CompleteAiPromptJob;
    readonly ackRalphCancel: AckRalphCancel;
    readonly checkRepoUsage: CheckRepoUsage;
    readonly requestRepoAccess: RequestRepoAccess;
    readonly initLocalKb: InitLocalKb;
    // Расширенный набор agent-операций (MCP 0.10): чтение/удаление KB, правка/удаление
    // задач, коммиты, проект/участники/поиск, финансы.
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
    // Автоматизация проектов (см. план virtual-exploring-pascal.md).
    readonly getAutomationConfig: GetAutomationConfig;
    readonly saveAutomationConfig: SaveAutomationConfig;
    readonly getAutomationForDispatcher: GetAutomationForDispatcher;
    readonly recordAutomationTask: RecordAutomationTask;
    readonly ingestAgentSnapshot: IngestAgentSnapshot;
    readonly listMonitoredServers: ListMonitoredServers;
    readonly setProjectDispatcher: SetProjectDispatcher;
    readonly getDelegatedGitToken: GetDelegatedGitToken;
    readonly rateLimiter: InMemoryRateLimiter;
    readonly dispatchCommentNotifications: DispatchCommentNotifications;
    readonly sendTelegramNotification: SendAgentTelegramNotification;
    readonly broadcastTelegramByTask: BroadcastTelegramNotificationByTask;
    readonly projects: ProjectRepository;
  };
};

// Возвращаем не только app, но и upgrade-handler — index.ts вешает его на server
// для HMR WebSocket'а Vite (без этого HMR через Express'овый dev-gateway не работает).
export type CreatedApp = {
  readonly app: Express;
  readonly devProxyUpgrade: ProxyRequestHandler['upgrade'] | null;
};

export function createApp(deps: AppDeps): CreatedApp {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // Каждый запрос проходит через session-resolver. Не делает auth обязательным —
  // только прикладывает req.user, если cookie валиден.
  app.use(sessionFromCookie(deps.auth.getCurrentUser));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    '/api/auth',
    authRouter({
      register: deps.auth.register,
      login: deps.auth.login,
      logout: deps.auth.logout,
      updateProfile: deps.user.updateProfile,
      // Шарим тот же агентский лимитер: процесс single-PM2, ключи изолированы префиксом.
      rateLimiter: deps.agent.rateLimiter,
    }),
  );

  app.use(
    '/api/projects',
    projectsRouter({
      ...deps.projects,
      notifier: deps.notifications.projectNotifier,
    }),
  );
  app.use('/api/integrations/github', githubRouter(deps.github));
  app.use('/api/projects/:projectId/secrets', secretsRouter(deps.secrets));
  app.use('/api/projects/:projectId/monitoring', monitoringRouter(deps.monitoring));
  app.use(
    '/api/projects/:projectId/kb',
    kbRouter({ ...deps.kb, notifier: deps.notifications.projectNotifier }),
  );
  app.use(
    '/api/projects/:projectId/tasks',
    tasksRouter({
      ...deps.tasks,
      notifier: deps.notifications.projectNotifier,
      assignToProject: deps.delegations.assignToProject,
      delegateExisting: deps.delegations.delegateExisting,
    }),
  );
  // LIVE-вкладка (cookie requireAuth + requireProjectAccess внутри): read + SSE /stream.
  // Пути роутера начинаются с /:projectId/tasks/:taskId/live/... — маунт под /api/projects
  // ПОСЛЕ tasksRouter (несовпавшие /live/* пути проваливаются сюда).
  app.use(
    '/api/projects',
    liveUserRouter({
      service: deps.live.service,
      liveEventHub: deps.live.liveEventHub,
    }),
  );
  app.use('/api/delegations', delegationsRouter(deps.delegations));
  app.use('/api/search', searchRouter(deps.search));
  app.use('/api/admin', adminRouter(deps.admin));
  app.use('/api/employees', employeesRouter({ manage: deps.finance.manageEmployees }));
  app.use(
    '/api/projects/:projectId/finance',
    financeRouter({
      getFinance: deps.finance.getProjectFinance,
      manage: deps.finance.manageProjectFinance,
    }),
  );
  app.use('/api/attachments', attachmentBinaryRouter(deps.tasks));
  app.use('/api/inbox', inboxRouter({ getOrCreateInbox: deps.projects.getOrCreateInbox }));
  app.use(
    '/api/me/telegram',
    meTelegramRouter({
      connect: deps.telegram.connect,
      status: deps.telegram.status,
      users: deps.telegram.users,
    }),
  );
  app.use(
    '/api/me/notification-prefs',
    meNotificationPrefsRouter({
      users: deps.telegram.users,
      members: deps.projects.members,
    }),
  );
  app.use(
    '/api/me/kanban-colors',
    meKanbanColorsRouter({ users: deps.telegram.users }),
  );
  app.use(
    '/api/me/shared-members',
    sharedMembersRouter({ listSharedMembers: deps.projects.listSharedMembers }),
  );
  app.use(
    '/api/telegram/webhook',
    telegramWebhookRouter({
      handler: deps.telegram.handler,
      secretToken: deps.telegram.webhookSecret,
    }),
  );
  // Invites: GET — anon-доступ; POST /:token/accept — внутри router'а через requireAuth.
  app.use('/api/invites', invitesRouter({
    getByToken: deps.invites.getByToken,
    accept: deps.invites.accept,
  }));
  app.use('/api/notifications', notificationsRouter(deps.notifications));

  // Agent tokens management (session-auth)
  app.use(
    '/api/agent/tokens',
    agentTokensRouter({
      create: deps.agent.createAgentToken,
      list: deps.agent.listAgentTokens,
      revoke: deps.agent.revokeAgentToken,
    }),
  );
  // Agent device-flow endpoints (mixed anon + session-auth, см. deviceRoutes.ts).
  // Маунт раньше agentApiRouter, чтобы /api/agent/device/* не проходил через Bearer-auth.
  app.use(
    '/api/agent/device',
    agentDeviceRouter({
      request: deps.agent.requestDeviceCode,
      approve: deps.agent.approveDeviceCode,
      poll: deps.agent.pollDeviceToken,
      info: deps.agent.getDeviceCodeInfo,
      rateLimiter: deps.agent.rateLimiter,
    }),
  );

  // Agent API endpoints (Bearer-auth) — все ответы НЕ кэшируются edge'ом/CDN.
  // Гипотеза по баг-репорту bug-comments-endpoint-transient-404.md (#5): кратко
  // закэшированный 404 на CDN продолжает выдавать 404 до истечения TTL. Любые
  // /api/agent/* — это agent-API, кэшировать на edge нельзя в принципе.
  app.use('/api/agent', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, private');
    next();
  });
  app.use(
    '/api/agent',
    agentApiRouter({
      authenticate: deps.agent.authenticateAgentToken,
      listProjects: deps.agent.listProjects,
      createProjectWithGit: deps.agent.createProjectWithGit,
      updateProject: deps.agent.updateProject,
      listUserRepos: deps.agent.listUserRepos,
      listKbDocuments: deps.agent.listKbDocuments,
      getCredential: deps.agent.getAgentCredential,
      createCredential: deps.agent.createAgentCredential,
      listTasks: deps.agent.listTasks,
      getTask: deps.agent.getAgentTask,
      createTask: deps.agent.createTask,
      createComment: deps.agent.createComment,
      listTaskCommentsForAgent: deps.agent.listTaskCommentsForAgent,
      moveTask: deps.agent.moveTask,
      linkCommit: deps.agent.linkCommit,
      writeKbDocument: deps.agent.writeKbDocument,
      listPendingAiPromptJobs: deps.agent.listPendingAiPromptJobs,
      claimAiPromptJob: deps.agent.claimAiPromptJob,
      completeAiPromptJob: deps.agent.completeAiPromptJob,
      enqueueAiPromptJob: deps.agent.enqueueAiPromptJob,
      waitForAiPromptJob: deps.agent.waitForAiPromptJob,
      uploadTaskAttachment: deps.tasks.uploadAttachment,
      maxAttachmentBytes: deps.tasks.maxAttachmentBytes,
      ackRalphCancel: deps.agent.ackRalphCancel,
      checkRepoUsage: deps.agent.checkRepoUsage,
      requestRepoAccess: deps.agent.requestRepoAccess,
      initLocalKb: deps.agent.initLocalKb,
      updateTask: deps.agent.updateTask,
      deleteTask: deps.agent.deleteTask,
      listTaskCommits: deps.agent.listTaskCommits,
      syncTaskCommits: deps.agent.syncTaskCommits,
      searchTasks: deps.agent.searchTasks,
      getProject: deps.agent.getProject,
      listProjectMembers: deps.agent.listProjectMembers,
      getKbDocument: deps.agent.getKbDocument,
      deleteKbDocument: deps.agent.deleteKbDocument,
      getProjectFinance: deps.agent.getProjectFinance,
      manageProjectFinance: deps.agent.manageProjectFinance,
      getMyAccount: deps.agent.getMyAccount,
      deleteProject: deps.agent.deleteProject,
      listMyDispatchedProjects: deps.agent.listMyDispatchedProjects,
      getAutomationForDispatcher: deps.agent.getAutomationForDispatcher,
      recordAutomationTask: deps.agent.recordAutomationTask,
      ingestAgentSnapshot: deps.agent.ingestAgentSnapshot,
      listMonitoredServers: deps.agent.listMonitoredServers,
      setProjectDispatcher: deps.agent.setProjectDispatcher,
      getDelegatedGitToken: deps.agent.getDelegatedGitToken,
      rateLimiter: deps.agent.rateLimiter,
      notifier: deps.notifications.projectNotifier,
      notifyTaskChanged: deps.tasks.notifyTaskChanged,
      notifyCommentAdded: deps.tasks.notifyCommentAdded,
      notifyStatusChanged: deps.tasks.notifyStatusChanged,
      taskRepo: deps.tasks.tasks,
      maybeReopenForClarification: deps.tasks.maybeReopenForClarification,
      dispatchCommentNotifications: deps.agent.dispatchCommentNotifications,
      sendTelegramNotification: deps.agent.sendTelegramNotification,
      broadcastTelegramByTask: deps.agent.broadcastTelegramByTask,
      projects: deps.agent.projects,
      users: deps.telegram.users,
    }),
  );

  // file-sync (Bearer-auth, тот же что у agentApiRouter): /api/agent/.../sync/* и .../events.
  // Маунтится отдельным роутером ПОСЛЕ agentApiRouter — несовпавшие пути проваливаются сюда.
  app.use(
    '/api/agent',
    fileSyncRouter({
      service: deps.fileSync.service,
      authenticate: deps.agent.authenticateAgentToken,
      maxBlobBytes: deps.fileSync.maxBlobBytes,
    }),
  );

  // LIVE ingest (Bearer, тот же authenticate): /api/agent/.../live/sessions(/:s/events|/finish).
  // Маунтится отдельным роутером ПОСЛЕ agentApiRouter+fileSyncRouter (несовпавшие пути сюда).
  app.use(
    '/api/agent',
    liveAgentRouter({
      service: deps.live.service,
      authenticate: deps.agent.authenticateAgentToken,
    }),
  );

  // AI-prompt-improvement (site-side, session-cookie auth): см. spec
  // 2026-05-28-ai-prompt-improvement-design.md. POST /api/ai/prompt-jobs + GET с long-poll.
  app.use(
    '/api',
    buildAiPromptRouter({
      enqueueAiPromptJob: deps.agent.enqueueAiPromptJob,
      waitForAiPromptJob: deps.agent.waitForAiPromptJob,
    }),
  );

  // Автоматизация проектов (site-side, session-cookie auth): см. план
  // virtual-exploring-pascal.md. GET/PUT /api/projects/:projectId/automation.
  app.use(
    '/api',
    buildAutomationRouter({
      getAutomationConfig: deps.agent.getAutomationConfig,
      saveAutomationConfig: deps.agent.saveAutomationConfig,
    }),
  );

  // 404 для неизвестных /api/*
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Static + SPA fallback.
  // Prod: `/` отдаёт лендинг для неавторизованных, SPA для авторизованных. Остальные
  //        пути (/login, /register, /projects/*, …) — всегда SPA из client/dist.
  // Dev:   тот же роутинг, но SPA проксируется в Vite (:5173) для HMR. Лендинг — из
  //        landing/dist статикой (он редко меняется; для HMR лендинга используй
  //        `npm run dev:landing` отдельно).
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(moduleDir, '../../../client/dist');
  const landingDist = resolve(moduleDir, '../../../landing/dist');
  const hasClient = existsSync(clientDist);
  const hasLanding = existsSync(landingDist);
  const isDev = process.env['NODE_ENV'] !== 'production';
  const viteTarget = process.env['VITE_DEV_TARGET'] ?? 'http://localhost:5173';
  const sessionCookieName = process.env['SESSION_COOKIE_NAME'] ?? 'pf_session';

  // Dev-gateway: проксируем всё что относится к Vite (HMR, source modules) и SPA-routes
  // на запущенный Vite-dev-server. Без этого фронт не доступен через Express в dev'е.
  let viteProxy: ProxyRequestHandler | null = null;
  if (isDev) {
    viteProxy = createProxyMiddleware({
      target: viteTarget,
      changeOrigin: true,
      ws: true,
      logger: console,
      on: {
        proxyReq: (proxyReq) => {
          // Vite 5+ режет module-script-load'ы по Sec-Fetch-Dest: script если запрос
          // приходит с другого origin (наш Express на :4317 vs Vite на :5173) — это
          // anti-XSSI protection (см. CVE-2025-30208). Поскольку у нас доверенный
          // dev-gateway, убираем эти headers — Vite будет видеть запрос как same-origin
          // и нормально отдаст модули.
          proxyReq.removeHeader('Sec-Fetch-Dest');
          proxyReq.removeHeader('Sec-Fetch-Site');
          proxyReq.removeHeader('Sec-Fetch-Mode');
          proxyReq.removeHeader('Sec-Fetch-User');
        },
      },
    });
    // Vite-internal paths — отдаём их в Vite БЕЗ стрипа префикса.
    // app.use(prefix, mw) срезает prefix из req.url, поэтому Vite получал /client
    // вместо /@vite/client и отдавал SPA-fallback HTML. Используем mount-less middleware
    // с явной проверкой пути — req.url остаётся целым.
    const viteProxyPaths = ['/@vite', '/@id', '/@react-refresh', '/@fs', '/src', '/node_modules'];
    app.use((req, res, next) => {
      if (viteProxyPaths.some((p) => req.url.startsWith(p))) {
        viteProxy!(req, res, next);
        return;
      }
      next();
    });
  }

  // Лендинг — всегда статика (когда landing/dist есть). Лежит ДО SPA-static, чтобы
  // его _astro/* ассеты резолвились первыми (у SPA в /assets/* — не конфликтует, но
  // index.html шлёт лендинговский путь к чанкам).
  if (hasLanding) app.use(express.static(landingDist, { index: false }));
  // SPA static — только в prod (в dev статика приходит из Vite).
  if (!isDev && hasClient) app.use(express.static(clientDist, { index: false }));

  // Главный роутинг: cookie-based для `/`, остальные пути — SPA.
  const isAuthed = (req: Request): boolean => Boolean(req.cookies?.[sessionCookieName]);

  // /landing — всегда отдаёт лендинг (даже если юзер залогинен). Полезно для preview
  // и показа лендинга без логаута.
  if (hasLanding) {
    app.get('/landing', (_req, res) => {
      res.sendFile(resolve(landingDist, 'index.html'));
    });
  }

  app.get('/', (req, res, next) => {
    if (isAuthed(req)) {
      // Авторизованный — отдаём SPA.
      if (isDev && viteProxy) {
        viteProxy(req, res, next);
        return;
      }
      if (hasClient) {
        res.sendFile(resolve(clientDist, 'index.html'));
        return;
      }
    }
    // Не авторизован (или нет client/dist) — лендинг.
    if (hasLanding) {
      res.sendFile(resolve(landingDist, 'index.html'));
      return;
    }
    // Без лендинга и без SPA — fallback в SPA если он есть.
    if (isDev && viteProxy) viteProxy(req, res, next);
    else if (hasClient) res.sendFile(resolve(clientDist, 'index.html'));
    else res.status(503).send('Frontend not available');
  });

  app.get('*', (req, res, next) => {
    if (isDev && viteProxy) {
      viteProxy(req, res, next);
      return;
    }
    if (hasClient) {
      res.sendFile(resolve(clientDist, 'index.html'));
      return;
    }
    next();
  });

  app.use(errorHandler);

  return { app, devProxyUpgrade: viteProxy?.upgrade ?? null };
}
