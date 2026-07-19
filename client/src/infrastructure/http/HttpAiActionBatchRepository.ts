import type {
  AiActionBatchRepository,
  AiActionBatchResult,
  CreateAiActionBatchInput,
} from '@/application/ai-action/AiActionBatchRepository';
import type { AiActionBatch } from '@/domain/ai-action/AiActionBatch';
import type { AiActionArtifact } from '@/domain/ai-action/AiActionArtifact';
import { httpClient } from './httpClient';

const base = '/ai/action-batches';

function path(batchId: string, suffix = ''): string {
  return `${base}/${encodeURIComponent(batchId)}${suffix}`;
}

export class HttpAiActionBatchRepository implements AiActionBatchRepository {
  async create(input: CreateAiActionBatchInput): Promise<{ batch: AiActionBatch; replayed: boolean }> {
    const result = await httpClient.post<{ batch: AiActionBatch; replayed: boolean }>(base, {
      ...input,
      items: input.items.map((item) => ({
        ...item,
        entityId: item.entityId ?? null,
        projectId: item.projectId ?? null,
      })),
    });
    return { batch: result.batch, replayed: result.replayed };
  }

  async get(batchId: string): Promise<AiActionBatch> {
    const result = await httpClient.get<{ batch: AiActionBatch }>(path(batchId));
    return result.batch;
  }

  async recordResults(batchId: string, results: readonly AiActionBatchResult[]): Promise<AiActionBatch> {
    const result = await httpClient.post<{ batch: AiActionBatch }>(path(batchId, '/results'), { results });
    return result.batch;
  }

  async apply(batchId: string, results: readonly AiActionBatchResult[] = []): Promise<AiActionBatch> {
    const result = await httpClient.post<{ batch: AiActionBatch }>(path(batchId, '/apply'), { results });
    return result.batch;
  }

  async reject(batchId: string): Promise<AiActionBatch> {
    const result = await httpClient.post<{ batch: AiActionBatch }>(path(batchId, '/reject'), {});
    return result.batch;
  }

  async undo(batchId: string): Promise<AiActionBatch> {
    const result = await httpClient.post<{ batch: AiActionBatch }>(path(batchId, '/undo'), {});
    return result.batch;
  }

  async listForConversation(conversationId: string): Promise<AiActionBatch[]> {
    const result = await httpClient.get<{ batches: AiActionBatch[] }>(
      `/ai/conversations/${encodeURIComponent(conversationId)}/action-batches`,
    );
    return result.batches;
  }

  async listArtifacts(conversationId: string): Promise<AiActionArtifact[]> {
    const result = await httpClient.get<{ artifacts: AiActionArtifact[] }>(
      `/ai/conversations/${encodeURIComponent(conversationId)}/artifacts`,
    );
    return result.artifacts;
  }
}
