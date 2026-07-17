import type { NextFunction, Request, RequestHandler, Response } from 'express';

const PROJECT_PATH = /^\/projects\/([^/]+)(?:\/|$)/;
const TASK_PATH = /\/tasks\/([^/]+)(?:\/|$)/;

function decodePathSegment(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// Account tokens are dispatcher credentials and retain the existing API surface.
// A worker capability is accepted only for its assigned project (and task when a
// task id appears in the URL). This is intentionally enforced before route code,
// so a future endpoint cannot accidentally rely on prompts for isolation.
export function requireAgentCapabilityScope(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.agentToken;
    if (!token) {
      res.status(401).json({ error: 'agent_token_required' });
      return;
    }
    if (token.scopeKind === 'account') {
      next();
      return;
    }

    // The profile is an explicitly shared account resource. Its presentation
    // never includes plaintext OAuth or agent tokens.
    if (req.method === 'GET' && req.path === '/me') {
      next();
      return;
    }

    const projectMatch = PROJECT_PATH.exec(req.path);
    const requestProjectId = decodePathSegment(projectMatch?.[1]);
    if (!requestProjectId || requestProjectId !== token.projectId) {
      res.status(403).json({ error: 'agent_project_scope_violation' });
      return;
    }

    const taskMatch = TASK_PATH.exec(req.path);
    const requestTaskId = decodePathSegment(taskMatch?.[1]);
    if (token.taskId && requestTaskId && requestTaskId !== token.taskId) {
      res.status(403).json({ error: 'agent_task_scope_violation' });
      return;
    }

    next();
  };
}
