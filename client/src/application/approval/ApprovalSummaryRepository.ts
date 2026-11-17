import type { ApprovalSummary } from '@/domain/approval/ApprovalSummary';

export interface ApprovalSummaryRepository {
  /** GET /projects/:projectId/tasks/:taskId/approval-summary — сводка собирается на сервере. */
  get(projectId: string, taskId: string): Promise<ApprovalSummary>;
}
