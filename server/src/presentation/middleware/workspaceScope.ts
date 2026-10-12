import type { RequestHandler } from 'express';
import type { ActiveWorkspace } from '../../application/workspace/activeWorkspace.js';
import type { WorkspaceRepository } from '../../application/workspace/WorkspaceRepository.js';

type Deps = {
  workspaces: Pick<WorkspaceRepository, 'getById' | 'getMembership' | 'getCurrentWorkspaceId' | 'findAnotherForUser'>;
  run: (userId: string, workspace: ActiveWorkspace | null, next: () => void) => void;
};

export function workspaceScope(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    if (!req.user) return next();
    try {
      const requested = req.get('X-Workspace-Id')
        ?? (req.path === '/notifications/stream' && typeof req.query['workspaceId'] === 'string'
          ? req.query['workspaceId'] : undefined);
      const id = requested ?? await deps.workspaces.getCurrentWorkspaceId(req.user.id)
        ?? await deps.workspaces.findAnotherForUser(req.user.id, '');
      const membership = id ? await deps.workspaces.getMembership(id, req.user.id) : null;
      if (requested && !membership) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }
      const workspace = id && membership ? await deps.workspaces.getById(id) : null;
      deps.run(req.user.id, workspace ? { id: workspace.id, kind: workspace.kind } : null, next);
    } catch (error) { next(error); }
  };
}
