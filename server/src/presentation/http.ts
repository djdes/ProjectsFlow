import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
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
import { sessionFromCookie } from './middleware/sessionFromCookie.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './auth/routes.js';
import { projectsRouter } from './projects/routes.js';
import { githubRouter } from './integrations/github/routes.js';
import { secretsRouter } from './secrets/routes.js';
import { kbRouter } from './kb/routes.js';
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
};

export function createApp(deps: AppDeps): Express {
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

  // 404 для неизвестных /api/*
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // SPA: serve client/dist when present (prod). In dev Vite serves the client on :5173.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(moduleDir, '../../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get('*', (_req, res) => {
      res.sendFile(resolve(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
