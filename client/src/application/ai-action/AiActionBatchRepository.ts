import type {
  AiActionBatch,
  AiActionBeforeSnapshot,
  AiActionEntityKind,
} from '@/domain/ai-action/AiActionBatch';
import type { AiActionType } from '@/domain/ai-action/AiAction';
import type { AiActionArtifact } from '@/domain/ai-action/AiActionArtifact';

export type AiActionBatchPlanItem = {
  actionId: string;
  type: AiActionType;
  entityKind: AiActionEntityKind;
  entityId?: string | null;
  projectId?: string | null;
  title: string;
};

export type CreateAiActionBatchInput = {
  conversationId: string;
  // null только для плана, отрисованного до того, как сообщение получило id.
  messageId: string | null;
  idempotencyKey?: string;
  title: string;
  projectId?: string | null;
  items: readonly AiActionBatchPlanItem[];
};

export type AiActionBatchResult = {
  actionId: string;
  entityId: string | null;
  projectId: string | null;
  title?: string;
  status: 'done' | 'failed';
  before?: AiActionBeforeSnapshot | null;
  errorMessage?: string | null;
};

export interface AiActionBatchRepository {
  /**
   * Создать или получить уже существующий батч. `replayed: true` означает, что план
   * с этим messageId уже журналировался — исполнять его повторно НЕЛЬЗЯ.
   */
  create(input: CreateAiActionBatchInput): Promise<{ batch: AiActionBatch; replayed: boolean }>;
  get(batchId: string): Promise<AiActionBatch>;
  // Зафиксировать результаты выполнения (id созданного, снимки before) без смены статуса.
  recordResults(batchId: string, results: readonly AiActionBatchResult[]): Promise<AiActionBatch>;
  // Подтвердить разрушительную стадию: pending_review → applied.
  apply(batchId: string, results?: readonly AiActionBatchResult[]): Promise<AiActionBatch>;
  reject(batchId: string): Promise<AiActionBatch>;
  undo(batchId: string): Promise<AiActionBatch>;
  listForConversation(conversationId: string): Promise<AiActionBatch[]>;
  // Панель Artifacts: журнал созданного/изменённого за диалог. Удаление объектов
  // список НЕ сокращает — это лог действий, а не состояние воркспейса.
  listArtifacts(conversationId: string): Promise<AiActionArtifact[]>;
}
