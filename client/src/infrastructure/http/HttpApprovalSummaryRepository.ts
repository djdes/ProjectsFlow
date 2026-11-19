import type { ApprovalSummaryRepository } from '@/application/approval/ApprovalSummaryRepository';
import type { ApprovalSummary } from '@/domain/approval/ApprovalSummary';
import { httpClient } from './httpClient';

type ApprovalSummaryDto = {
  summary: string | null;
  generatedAt: string | null;
};

export class HttpApprovalSummaryRepository implements ApprovalSummaryRepository {
  async get(projectId: string, taskId: string): Promise<ApprovalSummary> {
    const dto = await httpClient.get<ApprovalSummaryDto>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/approval-summary`,
    );
    const summary = typeof dto?.summary === 'string' && dto.summary.trim() ? dto.summary : null;
    return { summary, generatedAt: summary && dto.generatedAt ? new Date(dto.generatedAt) : null };
  }
}
