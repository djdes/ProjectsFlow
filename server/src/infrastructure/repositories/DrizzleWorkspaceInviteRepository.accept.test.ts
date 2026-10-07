import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleWorkspaceInviteRepository } from './DrizzleWorkspaceInviteRepository.js';
import type { Database } from '../db/index.js';
import { workspaceMembers, workspaceProjectExclusions } from '../db/schema.js';
import { WorkspaceInviteAlreadyUsedError, WorkspaceInviteExpiredError } from '../../domain/workspace/errors.js';

const now = new Date('2026-10-07T10:00:00Z');
const invite = { id: 'invite', workspaceId: 'ws', role: 'editor', acceptedAt: null, expiresAt: new Date('2026-10-08'), excludedProjectIds: ['hidden', 'moved'] };
function fixture(inserted = true, row: Omit<typeof invite, 'acceptedAt'> & { acceptedAt: Date | null } = invite) {
  const writes: Array<{ table: unknown; value: unknown }> = [];
  let consumed = false;
  let lock = '';
  const queue = [[row], [{ id: 'hidden' }, { id: 'visible' }]];
  const tx = {
    select: () => {
      const rows = queue.shift();
      const chain = { from: () => chain, where: () => chain, for: (mode: string) => { lock = mode; return chain; }, then: (resolve: (value: unknown) => void) => resolve(rows) };
      return chain;
    },
    insert: (table: unknown) => {
      const chain = { ignore: () => chain, values: async (value: unknown) => { writes.push({ table, value }); return [{ affectedRows: inserted ? 1 : 0 }]; } };
      return chain;
    },
    update: () => ({ set: () => ({ where: async () => { consumed = true; } }) }),
  };
  const db = { transaction: async (run: (connection: typeof tx) => Promise<void>) => run(tx) } as unknown as Database;
  return { repo: new DrizzleWorkspaceInviteRepository(db), writes, consumed: () => consumed, lock: () => lock };
}
test('acceptance locks the token and writes membership, valid exclusions and consumption in one transaction', async () => {
  const f = fixture();
  await f.repo.acceptWithMembership({ inviteId: 'invite', acceptedAt: now, acceptedByUserId: 'new' });
  assert.equal(f.lock(), 'update');
  assert.equal(f.consumed(), true);
  assert.deepEqual(f.writes, [
    { table: workspaceMembers, value: { workspaceId: 'ws', userId: 'new', role: 'editor' } },
    { table: workspaceProjectExclusions, value: [{ workspaceId: 'ws', userId: 'new', projectId: 'hidden' }] },
  ]);
});
test('existing membership does not receive invitation exclusions or a changed role', async () => {
  const f = fixture(false);
  await f.repo.acceptWithMembership({ inviteId: 'invite', acceptedAt: now, acceptedByUserId: 'existing' });
  assert.equal(f.writes.length, 1);
  assert.equal(f.consumed(), true);
});
test('token is checked again under lock before any membership writes', async () => {
  const expired = fixture(true, { ...invite, expiresAt: now });
  await assert.rejects(expired.repo.acceptWithMembership({ inviteId: 'invite', acceptedAt: now, acceptedByUserId: 'new' }), WorkspaceInviteExpiredError);
  assert.deepEqual(expired.writes, []);
  const used = fixture(true, { ...invite, acceptedAt: now });
  await assert.rejects(used.repo.acceptWithMembership({ inviteId: 'invite', acceptedAt: now, acceptedByUserId: 'new' }), WorkspaceInviteAlreadyUsedError);
  assert.deepEqual(used.writes, []);
});
