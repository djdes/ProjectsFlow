// «Добавить из соседних»: люди из других пространств приглашающего, которых ещё нет в целевом.
// См. docs/superpowers/specs/2026-11-12-invite-from-neighbor-workspaces-design.md.

export type InviteCandidateWorkspace = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
};

export type InviteCandidate = {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly hasTelegram: boolean;
  // Общие с приглашающим пространства — откуда человек «сосед».
  readonly workspaces: readonly InviteCandidateWorkspace[];
  // Есть непринятое и неистёкшее приглашение на его почту в целевое пространство.
  readonly invited: boolean;
};

export interface WorkspaceNeighborsRepository {
  // Участники пространств приглашающего (кроме него и текущих участников целевого), без
  // удалённых аккаунтов. Порядок — по имени.
  listCandidates(actorUserId: string, workspaceId: string, now: Date): Promise<InviteCandidate[]>;
}
