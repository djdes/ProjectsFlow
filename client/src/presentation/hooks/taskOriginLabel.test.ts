import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskOriginLabel } from './taskOriginLabel';

const project = {
  sharedWorkspaces: [
    { id: 'dev', name: 'Программисты', icon: null },
    { id: 'office', name: 'Офис', icon: null },
  ],
};

test('a task from another workspace of a shared project gets its name', () => {
  assert.equal(taskOriginLabel(project, 'dev', { originWorkspaceId: 'office' }), 'Офис');
  assert.equal(taskOriginLabel(project, 'office', { originWorkspaceId: null }), 'Программисты');
});

test('own workspace, unshared projects and unknown origins', () => {
  assert.equal(taskOriginLabel(project, 'office', { originWorkspaceId: 'office' }), null);
  assert.equal(taskOriginLabel({ sharedWorkspaces: [] }, 'dev', { originWorkspaceId: 'office' }), null);
  assert.equal(taskOriginLabel(null, 'dev', { originWorkspaceId: 'office' }), null);
  assert.equal(taskOriginLabel(project, 'dev', { originWorkspaceId: 'gone' }), null, 'unknown origin = home = current');
});
