import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommitSyncPolicy } from './CommitSyncPolicy.js';
import type { WorkspaceCommitSyncMode } from '../../domain/workspace/Workspace.js';

function policy(workspaceMode: WorkspaceCommitSyncMode | null, workspaceId: string | null = 'ws1') {
  return new CommitSyncPolicy({
    projects: { async getWorkspaceId() { return workspaceId; } },
    workspaces: {
      async getById() {
        return workspaceMode ? { commitSyncMode: workspaceMode } : null;
      },
    },
  });
}

test('пространство выключило сверку — пер-проектный режим не спасает', async () => {
  assert.deepEqual(await policy('off').resolve('p1', 'auto'), { enabled: false });
  assert.deepEqual(await policy('off').resolve('p1', null), { enabled: false });
});

test('проект выбрал режим — он важнее режима пространства', async () => {
  assert.deepEqual(await policy('propose').resolve('p1', 'auto'), {
    enabled: true,
    action: 'auto',
  });
  assert.deepEqual(await policy('auto').resolve('p1', 'propose'), {
    enabled: true,
    action: 'propose',
  });
});

test('проект режим не выбирал — берётся режим пространства', async () => {
  assert.deepEqual(await policy('auto').resolve('p1', null), { enabled: true, action: 'auto' });
  assert.deepEqual(await policy('propose').resolve('p1', null), {
    enabled: true,
    action: 'propose',
  });
});

test('пространства нет (или проект вне пространства) — поведение как раньше', async () => {
  // Данных нет — запрещать сверку по этому нельзя; решает проект, дефолт 'propose'.
  assert.deepEqual(await policy(null).resolve('p1', 'auto'), { enabled: true, action: 'auto' });
  assert.deepEqual(await policy(null).resolve('p1', null), { enabled: true, action: 'propose' });
  assert.deepEqual(await policy('off', null).resolve('p1', null), {
    enabled: true,
    action: 'propose',
  });
});
