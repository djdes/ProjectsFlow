// Человек из другого пространства приглашающего, которого можно позвать в текущее
// («Добавить из соседних»).
export type InviteCandidate = {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly hasTelegram: boolean;
  // Общие с приглашающим пространства — откуда человек «сосед».
  readonly workspaces: ReadonlyArray<{ readonly id: string; readonly name: string; readonly icon: string | null }>;
  // Уже есть ожидающее приглашение в это пространство.
  readonly invited: boolean;
};

export type InviteNeighborStatus = 'queued' | 'reused' | 'member' | 'not_neighbor' | 'error';
