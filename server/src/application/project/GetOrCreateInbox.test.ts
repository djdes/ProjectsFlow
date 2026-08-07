import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetOrCreateInbox } from './GetOrCreateInbox.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';

const WS = 'ws-1';

function makeInbox(input: {
  // Имена проектов, которые видит САМ владелец (индекс (owner_id, name)).
  ownProjectNames?: readonly string[];
  // Имена проектов, занятые в пространстве кем угодно (индекс (workspace_id, name)).
  workspaceNames?: readonly string[];
  existingInbox?: Project | null;
}): { inbox: GetOrCreateInbox; created: () => { name: string } | null } {
  let created: { name: string } | null = null;
  const repo = {
    findInboxByOwner: async () => input.existingInbox ?? null,
    listProjectNamesInWorkspace: async () => [...(input.workspaceNames ?? [])],
    createWithOwnerMembership: async (p: { id: string; ownerId: string; name: string }) => {
      created = { name: p.name };
      return { id: p.id, name: p.name, isInbox: true } as unknown as Project;
    },
  } as unknown as ProjectRepository;
  const members = {
    listProjectsForUser: async () => (input.ownProjectNames ?? []).map((name) => ({ name })),
  } as unknown as ProjectMemberRepository;

  return {
    inbox: new GetOrCreateInbox({
      repo,
      members,
      idGen: () => 'new-id',
      resolveWorkspaceId: async () => WS,
    }),
    created: () => created,
  };
}

test('пустое пространство — inbox называется «Входящие»', async () => {
  const h = makeInbox({});
  await h.inbox.execute('owner-1');
  assert.equal(h.created()?.name, 'Входящие');
});

// Регрессия: unique-индексов ДВА — (owner_id, name) и (workspace_id, name) из db/073.
// Чужой inbox с именем 'Входящие' в список проектов владельца не входит, поэтому раньше
// имя бралось занятым и вставка падала 409 project_name_taken — второй человек в командном
// пространстве не мог открыть «Личные» вообще.
test('имя, занятое ЧУЖИМ проектом того же пространства, не выбирается', async () => {
  const h = makeInbox({ workspaceNames: ['Входящие'] });
  await h.inbox.execute('owner-2');
  assert.equal(h.created()?.name, 'Входящие (системный)');
});

test('все кандидаты заняты в пространстве — суффикс по владельцу, без timestamp', async () => {
  const h = makeInbox({
    workspaceNames: ['Входящие', 'Входящие (системный)', 'Входящие (inbox)'],
  });
  await h.inbox.execute('abcdef0123456789');
  assert.equal(h.created()?.name, 'Входящие (abcdef01)');
});

test('свой одноимённый проект по-прежнему учитывается', async () => {
  const h = makeInbox({ ownProjectNames: ['Входящие'] });
  await h.inbox.execute('owner-3');
  assert.equal(h.created()?.name, 'Входящие (системный)');
});

test('inbox уже есть — ничего не создаём', async () => {
  const existing = { id: 'inbox-1', name: 'Входящие', isInbox: true } as unknown as Project;
  const h = makeInbox({ existingInbox: existing });
  const got = await h.inbox.execute('owner-4');
  assert.equal(got, existing);
  assert.equal(h.created(), null);
});
