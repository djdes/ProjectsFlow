import type { TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { AiActionType } from './AiAction';

/**
 * Зеркало серверного журнала батчей (db/135). Именно он, а не localStorage, отвечает
 * теперь на два вопроса: «этот план уже исполнялся?» и «чем его откатить?» — поэтому
 * Undo переживает F5 и закрытие вкладки.
 */
export type AiActionBatchStatus = 'pending_review' | 'applied' | 'rejected' | 'undone';
export type AiActionBatchItemStatus = 'pending' | 'done' | 'failed' | 'undone';
export type AiActionEntityKind = 'project' | 'task';

// Снимок изменяемых планом полей ДО действия — единственный источник отката update_task.
export type AiActionBeforeSnapshot = {
  description?: string | null;
  status?: TaskStatus;
  deadline?: string | null;
  priority?: TaskPriority | null;
};

export type AiActionBatchItem = {
  readonly id: string;
  readonly position: number;
  readonly actionId: string;
  readonly type: AiActionType;
  readonly entityKind: AiActionEntityKind;
  readonly entityId: string | null;
  readonly projectId: string | null;
  readonly title: string;
  readonly status: AiActionBatchItemStatus;
  readonly errorMessage: string | null;
};

export type AiActionBatch = {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly projectId: string | null;
  readonly status: AiActionBatchStatus;
  readonly title: string;
  readonly appliedAt: string | null;
  readonly undoneAt: string | null;
  readonly createdAt: string;
  readonly items: readonly AiActionBatchItem[];
};

// Откатить можно только применённый батч; отклонённый ничего не менял, отменённый — уже откачен.
export function canUndoAiActionBatch(batch: AiActionBatch): boolean {
  return batch.status === 'applied' && batch.items.some((item) => item.status === 'done');
}
