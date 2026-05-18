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
import type { ConnectKbRepo } from '../application/kb/ConnectKbRepo.js';
import type { DisconnectKb } from '../application/kb/DisconnectKb.js';
import type { ListKbDocuments } from '../application/kb/ListKbDocuments.js';
import type { GetKbDocument } from '../application/kb/GetKbDocument.js';
import type { WriteKbDocument } from '../application/kb/WriteKbDocument.js';
import type { DeleteKbDocument } from '../application/kb/DeleteKbDocument.js';
import type { BulkCreateCredential } from '../application/kb/BulkCreateCredential.js';
import type { ListTasks } from '../application/task/ListTasks.js';
import type { CreateTask } from '../application/task/CreateTask.js';
import type { UpdateTask } from '../application/task/UpdateTask.js';
import type { MoveTask } from '../application/task/MoveTask.js';
import type { DeleteTask } from '../application/task/DeleteTask.js';
import type { LinkCommit } from '../application/task/LinkCommit.js';
import type { UnlinkCommit } from '../application/task/UnlinkCommit.js';
import type { ListTaskCommits } from '../application/task/ListTaskCommits.js';
import type { SyncTaskCommits } from '../application/task/SyncTaskCommits.js';
import type { CreateAgentToken } from '../application/agent/CreateAgentToken.js';
import type { ListAgentTokens } from '../application/agent/ListAgentTokens.js';
import type { RevokeAgentToken } from '../application/agent/RevokeAgentToken.js';
import type { AuthenticateAgentToken } from '../application/agent/AuthenticateAgentToken.js';
import type { GetAgentCredential } from '../application/agent/GetAgentCredential.js';
import { sessionFromCookie } from './middleware/sessionFromCookie.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './auth/routes.js';
import { projectsRouter } from './projects/routes.js';
import { githubRouter } from './integrations/github/routes.js';
import { secretsRouter } from './secrets/routes.js';
import { kbRouter } from './kb/routes.js';
import { tasksRouter } from './tasks/routes.js';
import { agentTokensRouter } from './agent/tokensRoutes.js';
import { agentApiRouter } from './agent/apiRoutes.js';
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
    readonly listProjectCommits: ListProjectCommits;
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
  };
  readonly agent: {
    readonly createAgentToken: CreateAgentToken;
    readonly listAgentTokens: ListAgentTokens;
    readonly revokeAgentToken: RevokeAgentToken;
    readonly authenticateAgentToken: AuthenticateAgentToken;
    readonly getAgentCredential: GetAgentCredential;
    // Переиспользуемые порты для agent API
    readonly listProjects: ListProjects;
    readonly listKbDocuments: ListKbDocuments;
    readonly listTasks: ListTasks;
    readonly moveTask: MoveTask;
    readonly linkCommit: LinkCommit;
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

  app.use('/api/projects', projectsRouter(deps.projects));
  app.use('/api/integrations/github', githubRouter(deps.github));
  app.use('/api/secrets', secretsRouter(deps.secrets));
  app.use('/api/projects/:projectId/kb', kbRouter(deps.kb));
  app.use('/api/projects/:projectId/tasks', tasksRouter(deps.tasks));

  // Agent tokens management (session-auth)
  app.use(
    '/api/agent/tokens',
    agentTokensRouter({
      create: deps.agent.createAgentToken,
      list: deps.agent.listAgentTokens,
      revoke: deps.agent.revokeAgentToken,
    }),
  );
  // Agent API endpoints (Bearer-auth)
  app.use(
    '/api/agent',
    agentApiRouter({
      authenticate: deps.agent.authenticateAgentToken,
      listProjects: deps.agent.listProjects,
      listKbDocuments: deps.agent.listKbDocuments,
      getCredential: deps.agent.getAgentCredential,
      listTasks: deps.agent.listTasks,
      moveTask: deps.agent.moveTask,
      linkCommit: deps.agent.linkCommit,
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
