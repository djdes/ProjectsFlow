import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';

// Узкий структурный порт — WorkspaceRepository ему соответствует (см. deps в index.ts).
export type ResolveWorkspaceForNewProjectDeps = {
  readonly getCurrentWorkspaceId: (userId: string) => Promise<string | null>;
  readonly getWorkspaceKind: (workspaceId: string) => Promise<WorkspaceKind | null>;
  readonly findSoleTeamWorkspaceForUser: (userId: string) => Promise<string | null>;
  readonly findAnotherForUser: (userId: string) => Promise<string | null>;
};

// Creating a project never silently redirects it to another workspace.
export async function resolveWorkspaceForNewProject(
  deps: ResolveWorkspaceForNewProjectDeps,
  userId: string,
): Promise<string> {
  const current = await deps.getCurrentWorkspaceId(userId);
  if (current) return current;
  const another = await deps.findAnotherForUser(userId);
  if (another) return another;
  throw new Error(`User ${userId} has no workspace`);
}
