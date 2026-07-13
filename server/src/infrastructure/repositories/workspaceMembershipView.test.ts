import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectRowVisibility,
  deriveMembership,
  deriveOwnersCount,
  type ProjectAccessRow,
  type WorkspaceMemberAccessRow,
} from './workspaceMembershipView.js';

const PROJECT_CREATED = new Date('2026-01-01T00:00:00Z');
const WM_CREATED = new Date('2026-02-02T00:00:00Z');

function proj(over: Partial<ProjectAccessRow> = {}): ProjectAccessRow {
  return {
    id: 'p1',
    workspaceId: 'w1',
    ownerId: 'u-owner',
    isInbox: false,
    createdAt: PROJECT_CREATED,
    ...over,
  };
}

function wm(userId: string, role: WorkspaceMemberAccessRow['role']): WorkspaceMemberAccessRow {
  return { userId, role, createdAt: WM_CREATED };
}

// projectRowVisibility — единый предикат «виден ли проект юзеру и с какой ролью».
// Источник истины и для findForProject, и для листингов (тот же инвариант, что раньше
// был продублирован руками в listProjectsWhere и приводил к выпадению своего inbox).
test('projectRowVisibility: свой inbox без ws-строки → виден, роль owner', () => {
  assert.deepEqual(projectRowVisibility(proj({ isInbox: true }), 'u-owner', null), { role: 'owner' });
});

test('projectRowVisibility: чужой inbox → null (приватность Входящих)', () => {
  assert.equal(projectRowVisibility(proj({ isInbox: true }), 'u2', { role: 'owner' }), null);
});

test('projectRowVisibility: не-inbox с ws-строкой → виден, роль = ws-роль', () => {
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    assert.deepEqual(projectRowVisibility(proj(), 'u2', { role }), { role });
  }
});

test('projectRowVisibility: не-inbox без ws-строки → null', () => {
  assert.equal(projectRowVisibility(proj(), 'u2', null), null);
});

test('projectRowVisibility: создатель не-inbox проекта → owner поверх ws-роли editor', () => {
  // owner_id === userId, ws-роль editor — создатель должен получить owner (danger zone).
  assert.deepEqual(projectRowVisibility(proj({ ownerId: 'u-c' }), 'u-c', { role: 'editor' }), {
    role: 'owner',
  });
  // И даже если ws-роль viewer — создатель всё равно owner своего проекта.
  assert.deepEqual(projectRowVisibility(proj({ ownerId: 'u-c' }), 'u-c', { role: 'viewer' }), {
    role: 'owner',
  });
});

test('projectRowVisibility: НЕ-создатель получает свою ws-роль без апгрейда', () => {
  for (const role of ['editor', 'viewer'] as const) {
    assert.deepEqual(projectRowVisibility(proj({ ownerId: 'u-c' }), 'u2', { role }), { role });
  }
});

test('deriveMembership: создатель не-inbox проекта → роль owner', () => {
  const m = deriveMembership(proj({ ownerId: 'u-c' }), 'u-c', wm('u-c', 'editor'));
  assert.deepEqual(m, { projectId: 'p1', userId: 'u-c', role: 'owner', joinedAt: WM_CREATED });
});

test('deriveMembership: ws-роль маппится 1:1 в роль проекта', () => {
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const m = deriveMembership(proj(), 'u2', wm('u2', role));
    assert.deepEqual(m, { projectId: 'p1', userId: 'u2', role, joinedAt: WM_CREATED });
  }
});

test('deriveMembership: не участник пространства → null', () => {
  assert.equal(deriveMembership(proj(), 'u2', null), null);
});

test('deriveMembership: inbox — владелец всегда owner, даже без ws-строки', () => {
  const m = deriveMembership(proj({ isInbox: true }), 'u-owner', null);
  assert.deepEqual(m, {
    projectId: 'p1',
    userId: 'u-owner',
    role: 'owner',
    joinedAt: PROJECT_CREATED,
  });
});

test('deriveMembership: inbox — участник пространства НЕ владелец → null (приватность Входящих)', () => {
  assert.equal(deriveMembership(proj({ isInbox: true }), 'u2', wm('u2', 'owner')), null);
});

test('deriveOwnersCount: inbox всегда 1, иначе — счётчик ws-owner-ов', () => {
  assert.equal(deriveOwnersCount({ isInbox: true }, 5), 1);
  assert.equal(deriveOwnersCount({ isInbox: false }, 2), 2);
  assert.equal(deriveOwnersCount({ isInbox: false }, 0), 0);
});
