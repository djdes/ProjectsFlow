import type {
  AiPromptJob,
  AiPromptJobMode,
  AiPromptJobStatus,
} from '../../domain/ai-prompt/AiPromptJob.js';

export type NewAiPromptJobInput = {
  readonly createdBy: string;
  readonly projectId: string | null;
  readonly dispatcherUserId: string;
  readonly mode: AiPromptJobMode;
  readonly inputText: string;
  readonly kbContext: string | null;
};

export type PendingAiPromptJob = {
  readonly id: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly createdAt: Date;
};

// Подсчёт queued AI-job'ов с группировкой: один counter на projectId (включая null
// для Inbox-bucket'а). Возвращается списком пар; null-projectId — отдельная запись.
export type AiPromptJobCountByProject = ReadonlyArray<{
  readonly projectId: string | null;
  readonly count: number;
}>;

export type AiPromptJobRepository = {
  create(input: NewAiPromptJobInput): Promise<AiPromptJob>;
  findById(id: string): Promise<AiPromptJob | null>;
  /**
   * Pending (status='queued') job'ы где dispatcher_user_id = userId. Сортировка
   * createdAt asc. limit 1..50.
   */
  listPendingForDispatcher(userId: string, limit: number): Promise<PendingAiPromptJob[]>;
  /**
   * Counter по project_id среди queued job'ов где dispatcher_user_id = userId.
   * Используется в ListMyDispatchedProjects.
   */
  countPendingByProjectForDispatcher(userId: string): Promise<AiPromptJobCountByProject>;
  /**
   * Атомарный claim: UPDATE WHERE id=? AND status='queued' SET status='running',
   * claimed_at=NOW(). Возвращает обновлённый job если apply удался, null иначе.
   */
  claimById(jobId: string): Promise<AiPromptJob | null>;
  /**
   * Финализация: queued|running → succeeded|failed|cancelled. Записывает
   * improved_text/error и finished_at.
   */
  complete(input: {
    readonly id: string;
    readonly status: Extract<AiPromptJobStatus, 'succeeded' | 'failed' | 'cancelled'>;
    readonly improvedText: string | null;
    readonly error: string | null;
  }): Promise<void>;
  /**
   * Cleanup: queued/running старше olderThan (TIMESTAMP) → cancelled с reason.
   * Возвращает количество обновлённых строк.
   */
  cancelStale(input: {
    readonly olderThan: Date;
    readonly reason: string;
    readonly statuses: ReadonlyArray<Extract<AiPromptJobStatus, 'queued' | 'running'>>;
  }): Promise<number>;
  /**
   * Cleanup: succeeded/failed старше olderThan → DELETE.
   */
  deleteTerminal(input: {
    readonly olderThan: Date;
  }): Promise<number>;
};
