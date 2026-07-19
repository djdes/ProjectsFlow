/**
 * Карточка панели Artifacts. Зеркало серверного типа.
 *
 * Это накопительный журнал за диалог: удаление объекта карточку НЕ убирает
 * (поведение оригинала — после удаления задач карточки «Создано» остались).
 */
export type AiActionArtifactAction = 'created' | 'updated';

export type AiActionArtifact = {
  readonly id: string;
  readonly entityKind: 'project' | 'task';
  readonly entityId: string | null;
  readonly projectId: string | null;
  readonly title: string;
  readonly action: AiActionArtifactAction;
  readonly undone: boolean;
};

const ACTION_LABELS: Record<AiActionArtifactAction, string> = {
  created: 'Создано',
  updated: 'Изменено',
};

export function artifactActionLabel(artifact: AiActionArtifact): string {
  return artifact.undone ? 'Отменено' : ACTION_LABELS[artifact.action];
}

// Ссылка на объект. Проект открывается сам, задача — через свой проект.
export function artifactHref(artifact: AiActionArtifact): string | null {
  if (artifact.entityKind === 'project' && artifact.entityId) {
    return `/projects/${artifact.entityId}`;
  }
  if (artifact.entityKind === 'task' && artifact.projectId && artifact.entityId) {
    return `/projects/${artifact.projectId}?task=${artifact.entityId}`;
  }
  return null;
}
