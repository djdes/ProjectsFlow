import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManageWorkspaceProjectAccess } from './ManageWorkspaceProjectAccess.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { NotWorkspaceLeadError, NotWorkspaceMemberError, NotWorkspaceOwnerError, WorkspaceNotFoundError } from '../../domain/workspace/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

function fixture() {
  const members = (['owner', 'lead', 'editor', 'viewer'] as const).map((role) => ({ workspaceId: 'ws', userId: role, role }));
  const exclusions: Array<{ projectId: string; userId: string }> = [];
  const events: string[] = [];
  const service = new ManageWorkspaceProjectAccess({
    workspaces: {
      getMembership: async (workspaceId, userId) => members.find((m) => m.workspaceId === workspaceId && m.userId === userId) ?? null,
      listMembers: async () => members,
    },
    access: {
      listProjects: async () => [{ id: 'p1', name: 'First', icon: null }, { id: 'p2', name: 'Second', icon: null }],
      listExclusions: async () => exclusions,
      setAccess: async (_ws, projectId, userId, visible) => {
        const index = exclusions.findIndex((x) => x.userId === userId && x.projectId === projectId);
        if (visible && index >= 0) exclusions.splice(index, 1);
        if (!visible && index < 0) exclusions.push({ projectId, userId });
      },
    },
    changed: async (ws, project) => { events.push(`${ws}/${project}`); },
  });
  return { service, exclusions, events };
}

for (const role of ['owner', 'lead'] satisfies WorkspaceRole[]) {
  test(`${role} can hide/restore access; repeated writes are idempotent`, async () => {
    const { service, exclusions, events } = fixture();
    await service.set('ws', role, 'p1', 'editor', false);
    await service.set('ws', role, 'p1', 'editor', false);
    assert.deepEqual(exclusions, [{ projectId: 'p1', userId: 'editor' }]);
    const read = await service.list('ws', role);
    assert.deepEqual(read.members.find((m) => m.userId === 'editor')?.hiddenProjectIds, ['p1']);
    await service.set('ws', role, 'p1', 'editor', true);
    assert.deepEqual(exclusions, []);
    assert.equal(events.length, 3);
  });
}
for (const role of ['editor', 'viewer']) {
  test(`${role} cannot change visibility via API service`, async () => {
    const { service, exclusions } = fixture();
    await assert.rejects(service.set('ws', role, 'p1', 'viewer', false), NotWorkspaceLeadError);
    assert.deepEqual(exclusions, []);
  });
}
test('hidden project names are not exposed in the access read model to restricted members', async () => {
  const { service } = fixture();
  await service.set('ws', 'owner', 'p1', 'editor', false);
  const read = await service.list('ws', 'editor');
  assert.deepEqual(read.projects.map((p) => p.id), ['p2']);
  assert.ok(!JSON.stringify(read).includes('p1'));
});
test('reject foreign projects, foreign members, outsiders and manager restrictions without writes', async () => {
  const { service, exclusions } = fixture();
  await assert.rejects(service.set('ws', 'owner', 'foreign', 'editor', false), ProjectNotFoundError);
  await assert.rejects(service.set('ws', 'owner', 'p1', 'outsider', false), NotWorkspaceMemberError);
  await assert.rejects(service.list('foreign', 'owner'), WorkspaceNotFoundError);
  await assert.rejects(service.set('ws', 'owner', 'p1', 'owner', false), NotWorkspaceOwnerError);
  await assert.rejects(service.set('ws', 'lead', 'p1', 'lead', false), NotWorkspaceOwnerError);
  assert.deepEqual(exclusions, []);
});
