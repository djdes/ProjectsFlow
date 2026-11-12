import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectedIds, draftFromView, toSaveInput } from './projectWorkspaceAccess';
import type { ProjectSharing } from '@/domain/project/ProjectSharing';

const view: ProjectSharing = {
  canManage: true,
  homeWorkspaceId: 'dev',
  workspaces: [
    { id: 'dev', name: 'Программисты', icon: null, isHome: true, connected: true, taskScope: { kind: 'all' } },
    { id: 'office', name: 'Офис', icon: null, isHome: false, connected: false, taskScope: { kind: 'own' } },
    { id: 'sales', name: 'Продажи', icon: null, isHome: false, connected: true, taskScope: { kind: 'selected', from: ['office'] } },
  ],
  members: [
    { userId: 'ivan', displayName: 'Иван', avatarUrl: null, workspaceIds: ['dev'], rule: { kind: 'selected', from: ['dev', 'office'] } },
    { userId: 'olga', displayName: 'Ольга', avatarUrl: null, workspaceIds: ['office'], rule: { kind: 'all' } },
  ],
};

test('connecting office: the home stays first, rules are kept', () => {
  const draft = draftFromView(view);
  const next = { ...draft, workspaces: new Map(draft.workspaces).set('office', { connected: true, scope: { kind: 'own' } }) };
  assert.deepEqual(connectedIds(view, next), ['dev', 'office', 'sales']);
  assert.deepEqual(toSaveInput(view, next).workspaces, [
    { workspaceId: 'dev', taskScope: { kind: 'all' } },
    { workspaceId: 'office', taskScope: { kind: 'own' } },
    { workspaceId: 'sales', taskScope: { kind: 'selected', from: ['office'] } },
  ]);
});

test('references to disconnected workspaces and rules of people without access are dropped', () => {
  const input = toSaveInput(view, draftFromView(view));
  assert.deepEqual(input.workspaces.find((w) => w.workspaceId === 'sales')?.taskScope, { kind: 'selected', from: [] });
  assert.deepEqual(input.members, [{ userId: 'ivan', taskScope: { kind: 'selected', from: ['dev'] } }]);
});
