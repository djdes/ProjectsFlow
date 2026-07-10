import type {
  CloseProposal,
  CloseProposalStatus,
} from '../../domain/close-proposal/CloseProposal.js';

export type NewCloseProposalInput = {
  readonly projectId: string;
  readonly taskId: string;
  readonly commitSha: string;
  readonly reason: string | null;
  // Job-источник (commit-sync прогон) — аудит. null у ручных.
  readonly sourceJobId: string | null;
};

export type CloseProposalRepository = {
  // Идемпотентно по UNIQUE(task_id, commit_sha): если предложение уже существует (в любом
  // статусе) — вернуть его без дубля (created=false). Иначе создать open (created=true).
  create(
    input: NewCloseProposalInput,
  ): Promise<{ readonly proposal: CloseProposal; readonly created: boolean }>;

  findById(id: string): Promise<CloseProposal | null>;

  // Открытые предложения проекта (для in-app списка и группового свода), новые сверху.
  listOpenByProject(projectId: string): Promise<CloseProposal[]>;

  // Атомарный переход open → terminal (confirmed|dismissed|expired). Возвращает обновлённое
  // предложение или null, если оно уже было не-open — так подтверждение/отклонение идемпотентно
  // (дубль кнопок в личке и группе, повторные клики).
  resolve(input: {
    readonly id: string;
    readonly status: Extract<CloseProposalStatus, 'confirmed' | 'dismissed' | 'expired'>;
    readonly resolvedBy: string | null;
  }): Promise<CloseProposal | null>;
};
