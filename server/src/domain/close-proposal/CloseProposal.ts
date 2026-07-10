// Предложение закрыть задачу (план sunny-spinning-sun.md, Фаза 1). Создаётся commit-sync'ом
// в режиме action='propose' вместо авто-перемещения: задача выглядит выполненной по коммиту —
// сервер предлагает закрыть, подтвердить может ЛЮБОЙ участник (TG-кнопка / in-app). Таблица
// task_close_proposals (db/101) даёт идемпотентность подтверждения, аудит и in-app карточку.

export type CloseProposalStatus = 'open' | 'confirmed' | 'dismissed' | 'expired';

export const CLOSE_PROPOSAL_STATUSES: readonly CloseProposalStatus[] = [
  'open',
  'confirmed',
  'dismissed',
  'expired',
];

export type CloseProposal = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  // Коммит, по которому задача выглядит выполненной.
  readonly commitSha: string;
  // Обоснование от модели («почему выглядит готовой»).
  readonly reason: string | null;
  // Job-источник (commit-sync прогон), для аудита. null у ручных/старых.
  readonly sourceJobId: string | null;
  readonly status: CloseProposalStatus;
  // Кто разрешил предложение (подтвердил/отклонил) и когда. null пока open.
  readonly resolvedBy: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
