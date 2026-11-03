import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeleteUserAsAdmin, GetUserDeletionPreview } from './DeleteUserAsAdmin.js';
import type { AdminRepository } from './AdminRepository.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import type { UserDeletionPlan, UserDeletionSnapshot } from '../../domain/user/userDeletion.js';

function setup(snapshot: UserDeletionSnapshot | null) {
  const executed: UserDeletionPlan[] = [];
  const deletedFiles: string[] = [];
  const repo = {
    loadUserDeletionSnapshot: async () => snapshot,
    deleteUser: async (_id: string, _actor: string, decide: (s: UserDeletionSnapshot) => UserDeletionPlan) => {
      if (!snapshot) throw new AdminUserError('user_not_found', 'Пользователь не найден');
      const plan = decide(snapshot); // throws before any mutation when blocked
      executed.push(plan);
      return { plan, storageKeys: ['a.png', 'b.pdf'] };
    },
  } as unknown as AdminRepository;
  const storage = {
    delete: async (key: string) => { deletedFiles.push(key); if (key === 'b.pdf') throw new Error('disk'); },
  };
  return {
    executed, deletedFiles,
    remove: new DeleteUserAsAdmin({ repo, storage: storage as never }),
    preview: new GetUserDeletionPreview(repo),
  };
}
const base: UserDeletionSnapshot = { userId: 'u', isAdmin: false, workspaces: [], projects: [] };

test('self-deletion is rejected before touching the repository', async () => {
  const h = setup(base);
  await assert.rejects(() => h.remove.execute('me', 'me'), (e: unknown) => e instanceof AdminUserError && e.code === 'cannot_modify_self');
  assert.equal(h.executed.length, 0);
});

test('admins and sole-owned team workspaces block execution with a readable reason; preview reports the same', async () => {
  const h = setup({
    ...base, isAdmin: true,
    workspaces: [{ id: 'w', name: 'Команда', kind: 'team', role: 'owner', recordedOwner: true,
      otherActiveMembers: 2, successor: null, successorIsOwner: false }],
  });
  await assert.rejects(() => h.remove.execute('u', 'me'), (e: unknown) => e instanceof AdminUserError
    && e.code === 'deletion_blocked' && /администратора/.test(e.message) && /«Команда»/.test(e.message));
  assert.equal(h.executed.length, 0);
  assert.deepEqual((await h.preview.execute('u', 'me')).blockers.map((b) => b.kind), ['admin', 'owned_workspace']);
});

test('successful deletion returns the plan and removes files after the commit, tolerating storage errors', async () => {
  const h = setup(base);
  const plan = await h.remove.execute('u', 'me');
  assert.deepEqual(plan.blockers, []);
  assert.equal(h.executed.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.deletedFiles, ['a.png', 'b.pdf']);
});

test('preview of a missing account is not found', async () => {
  await assert.rejects(() => setup(null).preview.execute('x', 'me'),
    (e: unknown) => e instanceof AdminUserError && e.code === 'user_not_found');
});
