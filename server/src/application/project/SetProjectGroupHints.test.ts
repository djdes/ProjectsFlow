import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SetProjectGroupHints } from './SetProjectGroupHints.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';

function make(role: string) {
  const patches: unknown[] = [];
  const project = { id: 'p1', name: 'Конфигуратор', isInbox: false };
  const deps = {
    projects: {
      async getById() { return project; },
      async update(_id: string, patch: unknown) { patches.push(patch); return { ...project, ...(patch as object) }; },
    },
    members: {
      async findForProject() { return { projectId: 'p1', userId: 'u1', role }; },
    },
  } as any;
  return { uc: new SetProjectGroupHints(deps), patches };
}

test('group hints: owner/lead saves normalized aliases and description', async () => {
  for (const role of ['owner', 'lead']) {
    const { uc, patches } = make(role);
    await uc.execute('p1', 'u1', { aliases: [' конфиг ', 'Конфиг', ''], shortDescription: '  Настройки   касс ' });
    assert.deepEqual(patches[0], { aliases: ['конфиг'], shortDescription: 'Настройки касс' });
  }
});

test('group hints: empty description clears it', async () => {
  const { uc, patches } = make('owner');
  await uc.execute('p1', 'u1', { aliases: [], shortDescription: '   ' });
  assert.deepEqual(patches[0], { aliases: [], shortDescription: null });
});

test('group hints: editor cannot change them', async () => {
  const { uc, patches } = make('editor');
  await assert.rejects(uc.execute('p1', 'u1', { aliases: ['x'], shortDescription: null }), InsufficientProjectRoleError);
  assert.equal(patches.length, 0);
});
