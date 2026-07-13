import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';

// Узкий структурный порт — WorkspaceRepository ему соответствует (см. deps в index.ts).
export type ResolveWorkspaceForNewProjectDeps = {
  readonly getCurrentWorkspaceId: (userId: string) => Promise<string | null>;
  readonly getWorkspaceKind: (workspaceId: string) => Promise<WorkspaceKind | null>;
  readonly findSoleTeamWorkspaceForUser: (userId: string) => Promise<string | null>;
  readonly findAnotherForUser: (userId: string) => Promise<string | null>;
};

/**
 * Куда положить НОВЫЙ проект юзера. Инвариант «единое командное пространство»:
 * если активное пространство юзера — его личный дефолт-хаб (агрегирующая вьюха, не
 * контейнер) и юзер состоит РОВНО в одном командном пространстве — новый проект едет
 * туда, а не в хаб (иначе команда «разъезжается» — часть проектов видна только автору).
 * При 0 или >1 team-пространств не угадываем — остаёмся в хабе (соло-юзер / неоднозначность).
 */
export async function resolveWorkspaceForNewProject(
  deps: ResolveWorkspaceForNewProjectDeps,
  userId: string,
): Promise<string> {
  const current = await deps.getCurrentWorkspaceId(userId);
  if (current) {
    const kind = await deps.getWorkspaceKind(current);
    if (kind === 'team') return current;
    const team = await deps.findSoleTeamWorkspaceForUser(userId);
    if (team) return team;
    return current;
  }
  const another = await deps.findAnotherForUser(userId);
  if (another) return another;
  throw new Error(`User ${userId} has no workspace`);
}
