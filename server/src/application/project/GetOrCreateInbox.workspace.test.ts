import assert from 'node:assert/strict';
import test from 'node:test';
import { GetOrCreateInbox } from './GetOrCreateInbox.js';
import { ProjectNameAlreadyExistsError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import { AssigneeNotSharedMemberError } from '../../domain/task/errors.js';

test('delegation uses the actor workspace even when the executor is viewing another workspace', async () => {
  const inbox = new GetOrCreateInbox({
    resolveWorkspaceId: async (id) => id === 'lead' ? 'team-a' : 'team-b',
    idGen: () => 'delegated-inbox',
    members: {
      listProjectsForUser: async () => [],
      listSharedUsersInWorkspace: async (actor: string, ws: string) => {
        assert.equal(actor, 'lead'); assert.equal(ws, 'team-a');
        return [{ id: 'executor' }];
      },
    } as never,
    repo: {
      findInboxByOwner: async (owner: string, ws: string) => {
        assert.equal(owner, 'executor'); assert.equal(ws, 'team-a'); return null;
      },
      listProjectNamesInWorkspace: async () => [],
      createWithOwnerMembership: async (p: Project) => p,
    } as never,
  });
  assert.equal((await inbox.execute('executor', 'lead')).workspaceId, 'team-a');
});

test('delegation cannot create an inbox for a colleague from another workspace', async () => {
  const inbox = new GetOrCreateInbox({
    resolveWorkspaceId: async () => 'team-a', idGen: () => 'unused',
    members: { listSharedUsersInWorkspace: async () => [] } as never,
    repo: { findInboxByOwner: async () => { assert.fail('must reject before reading another person inbox'); } } as never,
  });
  await assert.rejects(inbox.execute('outsider', 'lead'), AssigneeNotSharedMemberError);
});

test('one user has different inboxes in different workspaces and revisiting reuses each inbox', async () => {
  let active = 'a';
  const projects: Project[] = [];
  const inbox = new GetOrCreateInbox({
    resolveWorkspaceId: async () => active,
    idGen: () => `inbox-${projects.length}`,
    members: { listProjectsForUser: async () => projects } as never,
    repo: {
      findInboxByOwner: async (ownerId: string, workspaceId: string) =>
        projects.find((p) => p.ownerId === ownerId && p.workspaceId === workspaceId) ?? null,
      listProjectNamesInWorkspace: async (workspaceId: string) => projects.filter((p) => p.workspaceId === workspaceId).map((p) => p.name),
      createWithOwnerMembership: async (p: Project) => { projects.push(p); return p; },
    } as never,
  });
  const a = await inbox.execute('me');
  active = 'b';
  const b = await inbox.execute('me');
  assert.notEqual(a.id, b.id);
  assert.equal(a.workspaceId, 'a');
  assert.equal(b.workspaceId, 'b');
  active = 'a';
  assert.equal((await inbox.execute('me')).id, a.id);
  assert.equal(projects.length, 2);
});

test('a simultaneous inbox creation returns the database winner instead of 409', async () => {
  let winner: Project | null = null;
  const inbox = new GetOrCreateInbox({
    resolveWorkspaceId: async () => 'a', idGen: () => 'loser',
    members: { listProjectsForUser: async () => [] } as never,
    repo: {
      findInboxByOwner: async () => winner,
      listProjectNamesInWorkspace: async () => [],
      createWithOwnerMembership: async () => {
        winner = { id: 'winner', ownerId: 'me', workspaceId: 'a', isInbox: true } as Project;
        throw new ProjectNameAlreadyExistsError('Входящие');
      },
    } as never,
  });
  assert.equal((await inbox.execute('me')).id, 'winner');
});
