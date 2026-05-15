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
import { sessionFromCookie } from './middleware/sessionFromCookie.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './auth/routes.js';
import { projectsRouter } from './projects/routes.js';
import { githubRouter } from './integrations/github/routes.js';
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

  // 404 для неизвестных /api/*
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(errorHandler);

  return app;
}
