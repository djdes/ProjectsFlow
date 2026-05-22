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
import type { ReorderProjects } from '../application/project/ReorderProjects.js';
import type { CreateProjectWithGit } from '../application/project/CreateProjectWithGit.js';
import type { GetOrCreateInbox } from '../application/project/GetOrCreateInbox.js';
import type { ListProjectMembers } from '../application/project/ListProjectMembers.js';
import type { RemoveProjectMember } from '../application/project/RemoveProjectMember.js';
import type { UpdateProjectMemberRole } from '../application/project/UpdateProjectMemberRole.js';
import type { TransferProjectOwnership } from '../application/project/TransferProjectOwnership.js';
import type { CreateProjectInvite } from '../application/project/CreateProjectInvite.js';
import type { ListProjectInvites } from '../application/project/ListProjectInvites.js';
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
import type { PutSecret } from '../application/secrets/PutSecret.js';
import type { GetSecret } from '../application/secrets/GetSecret.js';
import type { DeleteSecret } from '../application/secrets/DeleteSecret.js';
import type { ListSecretKeys } from '../application/secrets/ListSecretKeys.js';
import type { InitKbRepo } from '../application/kb/InitKbRepo.js';
import type { InitLocalKb } from '../application/kb/InitLocalKb.js';
import type { CheckRepoUsage } from '../application/agent/CheckRepoUsage.js';
import type { RequestRepoAccess } from '../application/agent/RequestRepoAccess.js';
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
import type { CreateTaskComment } from '../application/task/CreateTaskComment.js';
import type { UpdateTaskComment } from '../application/task/UpdateTaskComment.js';
import type { DeleteTaskComment } from '../application/task/DeleteTaskComment.js';
import type { ListNotifications } from '../application/notifications/ListNotifications.js';
import type { CountUnreadNotifications } from '../application/notifications/CountUnreadNotifications.js';
import type { MarkNotificationRead } from '../application/notifications/MarkNotificationRead.js';
import type { MarkAllNotificationsRead } from '../application/notifications/MarkAllNotificationsRead.js';
import type { Notification as NotificationEntity } from '../domain/notifications/Notification.js';
import type { RealtimeEvent } from '../domain/realtime/RealtimeEvent.js';
import type { ProjectNotificationService } from '../application/notifications/ProjectNotificationService.js';
import type { ListAllProjects } from '../application/admin/ListAllProjects.js';
import type { ListAllUsers } from '../application/admin/ListAllUsers.js';
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
import type { EnqueueAgentJob } from '../application/agent/EnqueueAgentJob.js';
import type { CancelAgentJob } from '../application/agent/CancelAgentJob.js';
import type { ListAgentJobsForProject } from '../application/agent/ListAgentJobsForProject.js';
import type { ListPendingAgentJobs } from '../application/agent/ListPendingAgentJobs.js';
import type { ClaimAgentJob } from '../application/agent/ClaimAgentJob.js';
import type { CompleteAgentJob } from '../application/agent/CompleteAgentJob.js';
import type { AgentJobRepository } from '../application/agent/AgentJobRepository.js';
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
import { adminRouter } from './admin/routes.js';
import { employeesRouter } from './finance/employeeRoutes.js';
import { financeRouter } from './finance/routes.js';
import { attachmentBinaryRouter } from './tasks/attachmentBinaryRoutes.js';
import { inboxRouter } from './inbox/routes.js';
import { invitesRouter } from './invites/routes.js';
import { notificationsRouter } from './notifications/routes.js';
import { agentTokensRouter } from './agent/tokensRoutes.js';
import { agentApiRouter } from './agent/apiRoutes.js';
import { agentDeviceRouter } from './agent/deviceRoutes.js';
import { buildAgentJobsRouter } from './agent-jobs/routes.js';
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
  readonly projects: {
    readonly listProjects: ListProjects;
    readonly getProject: GetProject;
    readonly createProject: CreateProject;
    readonly updateProject: UpdateProject;
    readonly reorderProjects: ReorderProjects;
    readonly listProjectCommits: ListProjectCommits;
    readonly getOrCreateInbox: GetOrCreateInbox;
    readonly listMembers: ListProjectMembers;
    readonly removeMember: RemoveProjectMember;
    readonly updateMemberRole: UpdateProjectMemberRole;
    readonly transferOwnership: TransferProjectOwnership;
    readonly createInvite: CreateProjectInvite;
    readonly listInvites: ListProjectInvites;
    readonly deleteInvite: DeleteProjectInvite;
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
  readonly admin: {
    readonly listAllProjects: ListAllProjects;
    readonly listAllUsers: ListAllUsers;
    readonly updateUser: UpdateUserAsAdmin;
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
    readonly maxAttachmentBytes: number;
    readonly agentJobs: AgentJobRepository;
    readonly notifyTaskChanged: (projectId: string) => void;
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
    readonly moveTask: MoveTask;
    readonly linkCommit: LinkCommit;
    readonly writeKbDocument: WriteKbDocument;
    // Agent jobs (kanban-agent-runner)
    readonly enqueueAgentJob: EnqueueAgentJob;
    readonly cancelAgentJob: CancelAgentJob;
    readonly listAgentJobsForProject: ListAgentJobsForProject;
    readonly listPendingAgentJobs: ListPendingAgentJobs;
    readonly claimAgentJob: ClaimAgentJob;
    readonly completeAgentJob: CompleteAgentJob;
    readonly agentJobs: AgentJobRepository;
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
    readonly rateLimiter: InMemoryRateLimiter;
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
    }),
  );

  app.use(
    '/api/projects',
    projectsRouter({ ...deps.projects, notifier: deps.notifications.projectNotifier }),
  );
  app.use('/api/integrations/github', githubRouter(deps.github));
  app.use('/api/projects/:projectId/secrets', secretsRouter(deps.secrets));
  app.use('/api/projects/:projectId/kb', kbRouter(deps.kb));
  app.use(
    '/api/projects/:projectId/tasks',
    tasksRouter({ ...deps.tasks, notifier: deps.notifications.projectNotifier }),
  );
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
    }),
  );

  // Agent API endpoints (Bearer-auth)
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
      moveTask: deps.agent.moveTask,
      linkCommit: deps.agent.linkCommit,
      writeKbDocument: deps.agent.writeKbDocument,
      listPendingAgentJobs: deps.agent.listPendingAgentJobs,
      claimAgentJob: deps.agent.claimAgentJob,
      completeAgentJob: deps.agent.completeAgentJob,
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
      rateLimiter: deps.agent.rateLimiter,
      notifier: deps.notifications.projectNotifier,
    }),
  );

  app.use(
    '/api',
    buildAgentJobsRouter({
      enqueueAgentJob: deps.agent.enqueueAgentJob,
      cancelAgentJob: deps.agent.cancelAgentJob,
      listAgentJobsForProject: deps.agent.listAgentJobsForProject,
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
