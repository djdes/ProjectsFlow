import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSeeTask, taskOrigin, type ProjectSharing, type TaskVisibilityViewer } from './ProjectSharing.js';

// Пример владельца: «Программисты» (dev, основное) видят все задачи, «Офис» (office) — только свои.
const sharing = (patch: Partial<ProjectSharing> = {}): ProjectSharing => ({
  projectId: 'p',
  homeWorkspaceId: 'dev',
  workspaces: new Map([
    ['dev', { kind: 'all' }],
    ['office', { kind: 'own' }],
  ]),
  members: new Map(),
  ...patch,
});

const officeTask = { createdBy: 'manager', assigneeUserId: 'manager', originWorkspaceId: 'office' };
const devTask = { createdBy: 'coder', assigneeUserId: 'coder', originWorkspaceId: null };

const viewer = (patch: Partial<TaskVisibilityViewer>): TaskVisibilityViewer => ({
  userId: 'someone',
  viewerWorkspaceId: null,
  memberWorkspaceIds: [],
  isAdmin: false,
  ...patch,
});

test('the owner example: office tasks are visible to programmers, not the other way round', () => {
  const programmer = viewer({ userId: 'coder2', viewerWorkspaceId: 'dev', memberWorkspaceIds: ['dev'] });
  const manager = viewer({ userId: 'manager2', viewerWorkspaceId: 'office', memberWorkspaceIds: ['office'] });
  assert.equal(canSeeTask(sharing(), programmer, officeTask), true);
  assert.equal(canSeeTask(sharing(), programmer, devTask), true);
  assert.equal(canSeeTask(sharing(), manager, officeTask), true);
  assert.equal(canSeeTask(sharing(), manager, devTask), false);
});

test('author and assignee always see their task; project admins see everything', () => {
  const s = sharing({ workspaces: new Map([['dev', { kind: 'own' }], ['office', { kind: 'own' }]]) });
  const inOffice = (userId: string, isAdmin = false) =>
    viewer({ userId, viewerWorkspaceId: 'office', memberWorkspaceIds: ['office'], isAdmin });
  assert.equal(canSeeTask(s, inOffice('coder'), devTask), true, 'author');
  assert.equal(canSeeTask(s, inOffice('x'), { ...devTask, assigneeUserId: 'x' }), true, 'assignee');
  assert.equal(canSeeTask(s, inOffice('lead', true), devTask), true, 'admin');
  assert.equal(canSeeTask(s, inOffice('x'), devTask), false);
});

test('selected scope: own plus listed workspaces', () => {
  const s = sharing({
    workspaces: new Map([
      ['dev', { kind: 'all' }],
      ['office', { kind: 'selected', from: ['sales'] }],
      ['sales', { kind: 'own' }],
    ]),
  });
  const manager = viewer({ viewerWorkspaceId: 'office', memberWorkspaceIds: ['office'] });
  assert.equal(canSeeTask(s, manager, { ...officeTask, createdBy: 'a', assigneeUserId: 'a' }), true);
  assert.equal(canSeeTask(s, manager, { createdBy: 'a', assigneeUserId: 'a', originWorkspaceId: 'sales' }), true);
  assert.equal(canSeeTask(s, manager, { ...devTask, createdBy: 'a', assigneeUserId: 'a' }), false);
});

test('a personal rule replaces the workspace rule', () => {
  const s = sharing({
    members: new Map([
      ['ivan', { kind: 'selected', from: ['dev'] }],
      ['maria', { kind: 'all' }],
      ['petr', { kind: 'mine' }],
    ]),
  });
  const devViewer = (userId: string) => viewer({ userId, viewerWorkspaceId: 'dev', memberWorkspaceIds: ['dev'] });
  const officeViewer = (userId: string) => viewer({ userId, viewerWorkspaceId: 'office', memberWorkspaceIds: ['office'] });
  assert.equal(canSeeTask(s, devViewer('ivan'), officeTask), false, 'programmer Ivan does not see office tasks');
  assert.equal(canSeeTask(s, officeViewer('maria'), devTask), true, 'manager Maria sees programmers tasks');
  assert.equal(canSeeTask(s, devViewer('petr'), devTask), false, 'Petr sees only his own');
  assert.equal(canSeeTask(s, devViewer('petr'), { ...devTask, assigneeUserId: 'petr' }), true);
});

test('without a workspace context the rules of all member workspaces are united', () => {
  const both = viewer({ viewerWorkspaceId: null, memberWorkspaceIds: ['office', 'dev'] });
  assert.equal(canSeeTask(sharing(), both, devTask), true);
  const officeOnly = viewer({ viewerWorkspaceId: null, memberWorkspaceIds: ['office'] });
  assert.equal(canSeeTask(sharing(), officeOnly, devTask), false);
  // Контекст пространства, где человек не участник, ничего не открывает.
  const stranger = viewer({ viewerWorkspaceId: 'dev', memberWorkspaceIds: ['office'] });
  assert.equal(canSeeTask(sharing(), stranger, devTask), false);
});

test('an origin that is no longer connected counts as the home workspace', () => {
  const s = sharing();
  assert.equal(taskOrigin(s, { originWorkspaceId: 'gone' }), 'dev');
  assert.equal(taskOrigin(s, { originWorkspaceId: null }), 'dev');
  assert.equal(taskOrigin(s, { originWorkspaceId: 'office' }), 'office');
  const manager = viewer({ viewerWorkspaceId: 'office', memberWorkspaceIds: ['office'] });
  assert.equal(canSeeTask(s, manager, { ...officeTask, createdBy: 'a', assigneeUserId: 'a', originWorkspaceId: 'gone' }), false);
});

test('a project shared with nobody is fully visible (no sharing → callers skip the check)', () => {
  const lonely = sharing({ workspaces: new Map([['dev', { kind: 'own' }]]) });
  const member = viewer({ viewerWorkspaceId: 'dev', memberWorkspaceIds: ['dev'] });
  assert.equal(canSeeTask(lonely, member, { ...officeTask, createdBy: 'a', assigneeUserId: 'a', originWorkspaceId: null }), true);
});
