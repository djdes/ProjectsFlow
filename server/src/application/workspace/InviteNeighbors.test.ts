import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InviteNeighbors, ListWorkspaceInviteCandidates } from './InviteNeighbors.js';
import type { InviteCandidate } from './WorkspaceNeighborsRepository.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  CannotInviteToDefaultWorkspaceError,
  NotWorkspaceEditorError,
  WorkspaceInviteMemberExistsError,
} from '../../domain/workspace/errors.js';

const NOW = new Date('2026-11-12T10:00:00Z');

const candidate = (userId: string, email: string): InviteCandidate => ({
  userId,
  displayName: userId,
  email,
  avatarUrl: null,
  hasTelegram: false,
  workspaces: [{ id: 'office', name: 'Офис', icon: null }],
  invited: false,
});

function setup(opts: { kind?: 'team' | 'default'; failFor?: Record<string, Error>; reused?: string[] } = {}) {
  const roles: Record<string, WorkspaceRole> = { lead: 'lead', editor: 'editor', viewer: 'viewer', member: 'editor' };
  const workspaces = {
    async getMembership(workspaceId: string, userId: string) {
      const role = workspaceId === 'dev' ? roles[userId] : undefined;
      return role ? { workspaceId, userId, role, displayName: null, email: null, avatarUrl: null } : null;
    },
    async getById(id: string) {
      return id === 'dev' ? { id, kind: opts.kind ?? ('team' as const) } : null;
    },
  };
  const listed: string[] = [];
  const neighbors = {
    async listCandidates(actor: string) {
      listed.push(actor);
      return [candidate('anna', 'anna@x.ru'), candidate('boris', 'boris@x.ru')];
    },
  };
  const invited: Array<{ email: string | null; role: string; actorUserId: string }> = [];
  const createInvite = {
    async execute(input: { workspaceId: string; actorUserId: string; role: 'editor' | 'viewer'; email: string | null }) {
      const fail = input.email ? opts.failFor?.[input.email] : undefined;
      if (fail) throw fail;
      invited.push({ email: input.email, role: input.role, actorUserId: input.actorUserId });
      return { invite: {} as never, reused: (opts.reused ?? []).includes(input.email ?? ''), canShare: true };
    },
  };
  const list = new ListWorkspaceInviteCandidates({ neighbors, workspaces, now: () => NOW });
  const invite = new InviteNeighbors({ neighbors, workspaces, createInvite, now: () => NOW });
  return { list, invite, invited, listed };
}

test('candidates: editors and leads can list; viewers cannot; personal hub is refused', async () => {
  const { list, listed } = setup();
  assert.equal((await list.execute('dev', 'editor')).length, 2);
  assert.deepEqual(listed, ['editor']);
  await assert.rejects(list.execute('dev', 'viewer'), NotWorkspaceEditorError);
  await assert.rejects(setup({ kind: 'default' }).list.execute('dev', 'lead'), CannotInviteToDefaultWorkspaceError);
});

test('invite: emails come from the server; strangers and members are reported', async () => {
  const { invite, invited } = setup({ reused: ['boris@x.ru'] });
  const { results } = await invite.execute({
    workspaceId: 'dev',
    actorUserId: 'lead',
    userIds: ['anna', 'boris', 'stranger', 'member', 'anna'],
    role: 'viewer',
  });
  assert.deepEqual(results, [
    { userId: 'anna', status: 'queued' },
    { userId: 'boris', status: 'reused' },
    { userId: 'stranger', status: 'not_neighbor' },
    { userId: 'member', status: 'member' },
  ]);
  assert.deepEqual(invited, [
    { email: 'anna@x.ru', role: 'viewer', actorUserId: 'lead' },
    { email: 'boris@x.ru', role: 'viewer', actorUserId: 'lead' },
  ]);
});

test('invite: one failure does not stop the batch', async () => {
  const { invite } = setup({
    failFor: { 'anna@x.ru': new WorkspaceInviteMemberExistsError(), 'boris@x.ru': new Error('db down') },
  });
  const { results } = await invite.execute({ workspaceId: 'dev', actorUserId: 'lead', userIds: ['anna', 'boris'], role: 'editor' });
  assert.deepEqual(results, [
    { userId: 'anna', status: 'member' },
    { userId: 'boris', status: 'error' },
  ]);
});

test('invite: viewer cannot invite', async () => {
  await assert.rejects(
    setup().invite.execute({ workspaceId: 'dev', actorUserId: 'viewer', userIds: ['anna'], role: 'editor' }),
    NotWorkspaceEditorError,
  );
});
