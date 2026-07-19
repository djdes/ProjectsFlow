import type { AiAction, AiAffectedEntity } from '@/domain/ai-action/AiAction';
import type { AiActionBatch, AiActionBatchStatus } from '@/domain/ai-action/AiActionBatch';
import type { AiActionBatchPlanItem } from './AiActionBatchRepository';

export type AiActionBatchOutcome = 'applied' | 'rejected' | 'undone';

export function isDestructiveBatchItemType(type: string): boolean {
  return type === 'delete_task' || type === 'delete_all_tasks';
}

function planItemTitle(action: AiAction): string {
  if (action.type === 'create_project') return `Проект «${action.name}»`;
  if (action.type === 'create_task') return firstLine(action.description);
  if (action.type === 'update_task') return firstLine(action.description ?? 'Изменение задачи');
  return 'Удаление задачи';
}

function firstLine(value: string): string {
  return value.split('\n')[0]?.trim() || 'Без названия';
}

/**
 * План → строки журнала батча.
 *
 * Созидательные действия попадают без entityId: он ещё не существует и приедет на сервер
 * отдельным шагом (recordResults). Разрушительные, наоборот, разворачиваются ПОЛНОСТЬЮ —
 * по строке на каждый затрагиваемый объект, потому что `delete_all_tasks` на пять задач
 * обязан дать пять независимых восстановлений при откате.
 */
export function buildBatchPlanItems(
  autoActions: readonly AiAction[],
  affected: readonly AiAffectedEntity[],
  resolveProjectOrNull: (action: AiAction) => string | null,
): AiActionBatchPlanItem[] {
  const auto = autoActions.map((action) => ({
    actionId: action.id,
    type: action.type,
    entityKind: action.type === 'create_project' ? ('project' as const) : ('task' as const),
    entityId: action.type === 'update_task' ? action.taskId : null,
    projectId: action.type === 'create_project' ? null : resolveProjectOrNull(action),
    title: planItemTitle(action),
  }));
  const destructive = affected.map((entity) => ({
    actionId: entity.actionId,
    type: 'delete_task' as const,
    entityKind: entity.kind,
    entityId: entity.entityId,
    projectId: entity.projectId,
    title: entity.title,
  }));
  return [...auto, ...destructive];
}

// Список под удаление для карточки review — читается из журнала, а не из локального
// стейта, поэтому переживает перезагрузку в состоянии pending_review.
export function batchDestructiveEntities(batch: AiActionBatch): AiAffectedEntity[] {
  return batch.items.flatMap((item) => (
    isDestructiveBatchItemType(item.type) && item.entityId
      ? [{
        actionId: item.actionId,
        kind: item.entityKind,
        projectId: item.projectId ?? '',
        entityId: item.entityId,
        title: item.title,
      }]
      : []
  ));
}

// Что показать в карточке результата. Отклонённое удаление не перечисляем: оно не случилось.
export function batchListedEntities(
  batch: AiActionBatch,
  outcome: AiActionBatchOutcome,
): AiAffectedEntity[] {
  return batch.items.flatMap((item) => {
    if (item.status !== 'done') return [];
    if (outcome === 'rejected' && isDestructiveBatchItemType(item.type)) return [];
    return [{
      actionId: item.actionId,
      kind: item.entityKind,
      projectId: item.projectId ?? '',
      entityId: item.entityId ?? item.id,
      title: item.title,
    }];
  });
}

export type AiActionBatchCounts = {
  readonly done: number;
  readonly failed: number;
  readonly removed: number;
};

export function summarizeBatch(batch: AiActionBatch): AiActionBatchCounts {
  const safe = batch.items.filter((item) => !isDestructiveBatchItemType(item.type));
  return {
    // 'undone' тоже считается выполненным: действие БЫЛО совершено, о чём карточка и сообщает.
    done: safe.filter((item) => item.status === 'done' || item.status === 'undone').length,
    failed: safe.filter((item) => item.status === 'failed').length,
    removed: batch.items.filter(
      (item) => isDestructiveBatchItemType(item.type) && item.status === 'done',
    ).length,
  };
}

export function batchOutcome(status: AiActionBatchStatus): AiActionBatchOutcome {
  if (status === 'rejected') return 'rejected';
  if (status === 'undone') return 'undone';
  return 'applied';
}
