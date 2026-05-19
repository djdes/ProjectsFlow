import type { ProjectInvite, ProjectInviteRole } from '../../domain/project/ProjectInvite.js';

export type CreateProjectInviteInput = {
  readonly id: string;
  readonly projectId: string;
  readonly role: ProjectInviteRole;
  readonly token: string;
  readonly email: string | null;
  readonly expiresAt: Date;
  readonly createdByUserId: string;
};

export type AcceptProjectInviteInput = {
  readonly inviteId: string;
  readonly acceptedAt: Date;
  readonly acceptedByUserId: string;
};

export interface ProjectInviteRepository {
  create(input: CreateProjectInviteInput): Promise<ProjectInvite>;
  getById(inviteId: string): Promise<ProjectInvite | null>;
  // Главная look-up точка из accept-flow: получили token из URL, нашли invite.
  findByToken(token: string): Promise<ProjectInvite | null>;
  // Pending-инвайты для проекта (acceptedAt IS NULL, expiresAt > now). Для UI «Команда».
  listPendingByProject(projectId: string, now: Date): Promise<ProjectInvite[]>;
  // Атомарно помечаем как accepted (set acceptedAt + acceptedByUserId).
  markAccepted(input: AcceptProjectInviteInput): Promise<ProjectInvite | null>;
  delete(inviteId: string): Promise<boolean>;
}
