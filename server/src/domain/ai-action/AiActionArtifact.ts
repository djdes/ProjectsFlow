import type { AiActionBatch, AiActionType } from './AiActionBatch.js';

/**
 * Карточка панели Artifacts: что агент создал или изменил за диалог.
 *
 * Это НАКОПИТЕЛЬНЫЙ ЖУРНАЛ, а не состояние рабочего пространства (проверено на
 * оригинале: после удаления объектов карточки остались). Поэтому источник — строки
 * батчей, и удаление сущности их не убирает.
 */
export type AiActionArtifactAction = 'created' | 'updated';

export type AiActionArtifact = {
  readonly id: string;
  readonly entityKind: 'project' | 'task';
  readonly entityId: string | null;
  readonly projectId: string | null;
  readonly title: string;
  readonly action: AiActionArtifactAction;
  // Батч откатили: карточка остаётся в журнале, но помечена.
  readonly undone: boolean;
};

const ARTIFACT_ACTIONS: Partial<Record<AiActionType, AiActionArtifactAction>> = {
  create_project: 'created',
  create_task: 'created',
  update_task: 'updated',
};

const ACTION_LABELS: Record<AiActionArtifactAction, string> = {
  created: 'Создано',
  updated: 'Изменено',
};

export function artifactActionLabel(action: AiActionArtifactAction): string {
  return ACTION_LABELS[action];
}

/**
 * Батчи диалога → плоский список артефактов в хронологическом порядке.
 * Удаления не попадают: панель отвечает на вопрос «что появилось», а не «что исчезло».
 */
export function collectAiActionArtifacts(
  batches: readonly AiActionBatch[],
): AiActionArtifact[] {
  const artifacts: AiActionArtifact[] = [];
  for (const batch of batches) {
    if (batch.status === 'rejected') continue;
    for (const item of [...batch.items].sort((a, b) => a.position - b.position)) {
      const action = ARTIFACT_ACTIONS[item.type];
      // 'pending'/'failed' не показываем: действие не состоялось, показывать нечего.
      if (!action || (item.status !== 'done' && item.status !== 'undone')) continue;
      artifacts.push({
        id: item.id,
        entityKind: item.entityKind,
        entityId: item.entityId,
        projectId: item.projectId,
        title: item.title || 'Без названия',
        action,
        undone: item.status === 'undone',
      });
    }
  }
  return artifacts;
}
