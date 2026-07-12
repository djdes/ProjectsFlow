import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMembership,
  deriveProjectMembers,
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

test('deriveProjectMembers: обычный проект — все участники пространства с их ролями', () => {
  const list = deriveProjectMembers(proj(), [wm('u-owner', 'owner'), wm('u2', 'editor'), wm('u3', 'viewer')]);
  assert.deepEqual(
    list.map((m) => [m.userId, m.role]),
    [['u-owner', 'owner'], ['u2', 'editor'], ['u3', 'viewer']],
  );
});

test('deriveProjectMembers: inbox — ровно один участник (владелец), остальные отброшены', () => {
  const list = deriveProjectMembers(proj({ isInbox: true }), [wm('u-owner', 'editor'), wm('u2', 'owner')]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    projectId: 'p1',
    userId: 'u-owner',
    role: 'owner',
    joinedAt: WM_CREATED, // joinedAt владельца берётся из его ws-строки, если есть
  });
});

test('deriveProjectMembers: inbox без ws-строки владельца — joinedAt = createdAt проекта', () => {
  const list = deriveProjectMembers(proj({ isInbox: true }), []);
  assert.deepEqual(list, [
    { projectId: 'p1', userId: 'u-owner', role: 'owner', joinedAt: PROJECT_CREATED },
  ]);
});

test('deriveOwnersCount: inbox всегда 1, иначе — счётчик ws-owner-ов', () => {
  assert.equal(deriveOwnersCount({ isInbox: true }, 5), 1);
  assert.equal(deriveOwnersCount({ isInbox: false }, 2), 2);
  assert.equal(deriveOwnersCount({ isInbox: false }, 0), 0);
});
