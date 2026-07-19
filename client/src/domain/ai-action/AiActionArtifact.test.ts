import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiActionArtifact } from './AiActionArtifact';
import { artifactActionLabel, artifactHref } from './AiActionArtifact';

function artifact(overrides: Partial<AiActionArtifact> = {}): AiActionArtifact {
  return {
    id: 'item-1',
    entityKind: 'task',
    entityId: 'task-1',
    projectId: 'project-1',
    title: 'Сверстать макет',
    action: 'created',
    undone: false,
    ...overrides,
  };
}

test('labels artifacts by the action that produced them', () => {
  assert.equal(artifactActionLabel(artifact()), 'Создано');
  assert.equal(artifactActionLabel(artifact({ action: 'updated' })), 'Изменено');
  assert.equal(artifactActionLabel(artifact({ undone: true })), 'Отменено');
});

test('links a task through its project and a project directly', () => {
  assert.equal(artifactHref(artifact()), '/projects/project-1?task=task-1');
  assert.equal(
    artifactHref(artifact({ entityKind: 'project', entityId: 'project-9', projectId: null })),
    '/projects/project-9',
  );
});

test('has no link when the entity was never created', () => {
  assert.equal(artifactHref(artifact({ entityId: null })), null);
});
