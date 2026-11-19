import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotWorkspaceEditorError, NotWorkspaceLeadError, WorkspaceNotFoundError } from '../../domain/workspace/errors.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { TaskTemplateNotFoundError } from '../../domain/task/errors.js';
import type { WorkspaceTaskTemplate } from '../../domain/task/WorkspaceTaskTemplate.js';
import { ManageWorkspaceTaskTemplates } from './ManageWorkspaceTaskTemplates.js';
import type { WorkspaceTaskTemplateRepository } from './WorkspaceTaskTemplateRepository.js';

function makeHarness(roles: Record<string, WorkspaceRole>) {
  const rows = new Map<string, WorkspaceTaskTemplate>();
  let seq = 0;
  const templates: WorkspaceTaskTemplateRepository = {
    listByWorkspace: async (workspaceId) => [...rows.values()].filter((t) => t.workspaceId === workspaceId).reverse(),
    getById: async (id) => rows.get(id) ?? null,
    create: async (input) => {
      const row = { ...input, createdAt: new Date() };
      rows.set(input.id, row);
      return row;
    },
    delete: async (id) => {
      rows.delete(id);
    },
  };
  const manage = new ManageWorkspaceTaskTemplates({
    templates,
    workspaces: {
      getMembership: async (workspaceId, userId): Promise<WorkspaceMember | null> =>
        workspaceId === 'ws1' && roles[userId] ? { workspaceId, userId, role: roles[userId] } : null,
    },
    idGen: () => `tpl-${++seq}`,
  });
  return { manage, rows };
}

const BASE = {
  workspaceId: 'ws1',
  description: 'Еженедельный отчёт\n- [x] Собрать метрики\n- [ ] Отправить руководителю',
  priority: 2 as const,
  taskType: 'feature' as const,
  recurrence: { kind: 'weekly' as const, days: [5] as const },
};

test('a template keeps the text, priority, type and recurrence with an unchecked checklist', async () => {
  const h = makeHarness({ anna: 'editor' });
  const t = await h.manage.create({ ...BASE, userId: 'anna', recurrence: { kind: 'weekly', days: [5] } });

  assert.equal(t.workspaceId, 'ws1');
  assert.equal(t.name, 'Еженедельный отчёт');
  assert.equal(t.description, 'Еженедельный отчёт\n- [ ] Собрать метрики\n- [ ] Отправить руководителю');
  assert.equal(t.priority, 2);
  assert.equal(t.taskType, 'feature');
  assert.deepEqual(t.recurrence, { kind: 'weekly', days: [5] });
  assert.equal(t.createdBy, 'anna');
  assert.deepEqual((await h.manage.list('ws1', 'anna')).map((x) => x.id), [t.id]);
});

test('only workspace members see templates; viewers cannot save them', async () => {
  const h = makeHarness({ anna: 'editor', vera: 'viewer' });
  await assert.rejects(h.manage.list('ws1', 'stranger'), WorkspaceNotFoundError);
  await assert.rejects(h.manage.create({ ...BASE, recurrence: null, userId: 'stranger' }), WorkspaceNotFoundError);
  await assert.rejects(h.manage.create({ ...BASE, recurrence: null, userId: 'vera' }), NotWorkspaceEditorError);
  assert.deepEqual(await h.manage.list('ws1', 'vera'), []);
});

test('the author, a lead or the owner can delete a template; other members cannot', async () => {
  const h = makeHarness({ anna: 'editor', boris: 'editor', lena: 'lead', olga: 'owner' });
  const first = await h.manage.create({ ...BASE, recurrence: null, userId: 'anna' });
  await assert.rejects(h.manage.remove('ws1', first.id, 'boris'), NotWorkspaceLeadError);
  await h.manage.remove('ws1', first.id, 'anna');
  assert.equal(h.rows.size, 0);

  const second = await h.manage.create({ ...BASE, recurrence: null, userId: 'anna' });
  await h.manage.remove('ws1', second.id, 'lena');
  const third = await h.manage.create({ ...BASE, recurrence: null, userId: 'anna' });
  await h.manage.remove('ws1', third.id, 'olga');
  assert.equal(h.rows.size, 0);
});

test('a template of another workspace is reported as not found', async () => {
  const h = makeHarness({ anna: 'owner' });
  h.rows.set('foreign', { ...BASE, recurrence: null, id: 'foreign', workspaceId: 'ws2', name: 'Чужой', createdBy: 'x', createdAt: new Date() });
  await assert.rejects(h.manage.remove('ws1', 'foreign', 'anna'), TaskTemplateNotFoundError);
  assert.ok(h.rows.has('foreign'));
});

test('an explicit name wins and long names are shortened to the column size', async () => {
  const h = makeHarness({ anna: 'editor' });
  const named = await h.manage.create({ ...BASE, recurrence: null, userId: 'anna', name: '  Отчёт по пятницам ' });
  assert.equal(named.name, 'Отчёт по пятницам');
  const long = await h.manage.create({ ...BASE, recurrence: null, userId: 'anna', name: 'а'.repeat(300) });
  assert.equal(long.name.length, 120);
  assert.ok(long.name.endsWith('…'));
});
