import type { StoredApprovalSummary } from '../../domain/approval-summary/ApprovalSummary.js';

// Кэш ИИ-сводок полки «На утверждении» (db/186): одна строка на задачу.
export interface ApprovalSummaryRepository {
  find(taskId: string): Promise<StoredApprovalSummary | null>;
  // Upsert по task_id: новая сводка заменяет прежнюю вместе с хэшем входа.
  save(summary: StoredApprovalSummary): Promise<void>;
}
