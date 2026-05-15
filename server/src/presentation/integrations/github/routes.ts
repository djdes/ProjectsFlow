import { Router, type NextFunction, type Request, type Response } from 'express';
import type { StartDeviceFlow } from '../../../application/github/StartDeviceFlow.js';
import type { PollDeviceFlow } from '../../../application/github/PollDeviceFlow.js';
import type { DisconnectGithub } from '../../../application/github/DisconnectGithub.js';
import type { ListUserRepos } from '../../../application/github/ListUserRepos.js';
import type { GithubTokenRepository } from '../../../application/github/GithubTokenRepository.js';
import type {
  GithubConnection,
  GithubRepoSummary,
} from '../../../domain/github/GithubConnection.js';
import {
  GithubDeviceFlowExpiredError,
  GithubDeviceFlowPendingError,
  GithubDeviceFlowSlowDownError,
} from '../../../domain/github/errors.js';
import { requireAuth } from '../../middleware/requireAuth.js';

type Deps = {
  readonly startDeviceFlow: StartDeviceFlow;
  readonly pollDeviceFlow: PollDeviceFlow;
  readonly disconnectGithub: DisconnectGithub;
  readonly listUserRepos: ListUserRepos;
  readonly tokens: GithubTokenRepository;
};

type RepoSummaryDto = Omit<GithubRepoSummary, 'pushedAt'> & { pushedAt: string | null };

function repoToDto(r: GithubRepoSummary): RepoSummaryDto {
  return { ...r, pushedAt: r.pushedAt ? r.pushedAt.toISOString() : null };
}

type ConnectionDto = {
  githubLogin: string;
  githubUserId: string;
  scopes: string[];
  connectedAt: string;
};

function toDto(c: GithubConnection): ConnectionDto {
  return {
    githubLogin: c.githubLogin,
    githubUserId: c.githubUserId,
    scopes: [...c.scopes],
    connectedAt: c.connectedAt.toISOString(),
  };
}

export function githubRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  // Текущее состояние подключения (или null если не подключён).
  router.get('/me', async (req, res, next) => {
    try {
      const conn = await deps.tokens.getByUserId(req.user!.id);
      res.json({ connection: conn ? toDto(conn) : null });
    } catch (e) {
      next(e);
    }
  });

  // Запускаем device flow: возвращаем user_code + verification_uri.
  router.post('/connect/start', async (req, res, next) => {
    try {
      const r = await deps.startDeviceFlow.execute(req.user!.id);
      res.json({
        userCode: r.userCode,
        verificationUri: r.verificationUri,
        expiresAt: r.expiresAt.toISOString(),
        intervalSec: r.intervalSec,
      });
    } catch (e) {
      next(e);
    }
  });

  // Опрос: pending / connected. Errors → конкретные коды.
  router.post('/connect/poll', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deps.pollDeviceFlow.execute(req.user!.id);
      if (result.kind === 'connected') {
        res.json({ status: 'connected', connection: toDto(result.connection) });
        return;
      }
      res.json({ status: 'pending' });
    } catch (e) {
      // Преобразуем «ожидаемые» состояния в нормальный ответ (не 500-ка).
      if (e instanceof GithubDeviceFlowPendingError) {
        res.json({ status: 'pending' });
        return;
      }
      if (e instanceof GithubDeviceFlowSlowDownError) {
        res.json({ status: 'pending', slowDownSec: e.newInterval });
        return;
      }
      if (e instanceof GithubDeviceFlowExpiredError) {
        res.json({ status: 'expired' });
        return;
      }
      next(e);
    }
  });

  router.delete('/', async (req, res, next) => {
    try {
      await deps.disconnectGithub.execute(req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Список репозиториев пользователя (для picker'а на странице проекта).
  router.get('/repos', async (req, res, next) => {
    try {
      const repos = await deps.listUserRepos.execute(req.user!.id);
      res.json({ repos: repos.map(repoToDto) });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
