import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManageProjectSharing } from './ManageProjectSharing.js';
import type { SaveProjectSharingInput, ProjectSharingConfig } from './ProjectSharingRepository.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { ProjectNotFoundError, ProjectSharingForbiddenError, ProjectSharingInvalidError } from '../../domain/project/errors.js';

// dev — основное пространство проекта, office и sales — командные, personal — личный хаб.
const spaces = {
  dev: { id: 'dev', name: 'Программисты', icon: null, kind: 'team' as const },
  office: { id: 'office', name: 'Офис', icon: null, kind: 'team' as const },
  sales: { id: 'sales', name: 'Продажи', icon: null, kind: 'team' as const },
  personal: { id: 'personal', name: 'Личное', icon: null, kind: 'default' as const },
};
const roles: Record<string, Record<string, WorkspaceRole>> = {
  devlead: { dev: 'lead', office: 'owner', personal: 'owner' },
  coder: { dev: 'editor' },
  manager: { office: 'editor' },
  salesboss: { sales: 'owner' },
};

function make(config: ProjectSharingConfig | null = null) {
  const saved: SaveProjectSharingInput[] = [];
  const changed: string[][] = [];
  const service = new ManageProjectSharing({
    projects: {
      async getById(id) {
        return id === 'p' ? ({ id: 'p', workspaceId: 'dev', ownerId: 'author', isInbox: false } as never) : null;
      },
    },
    sharing: {
      async getConfig() { return config; },
      async saveConfig(_projectId, input) { saved.push(input); return { removedWorkspaceIds: [] }; },
      async memberships(userIds, projects) {
        return projects.flatMap((p) =>
          userIds.flatMap((userId) =>
            Object.entries(roles[userId] ?? {})
              .filter(([ws]) => p.workspaceIds.includes(ws))
              .map(([workspaceId, role]) => ({ projectId: p.projectId, workspaceId, userId, role, excluded: false })),
          ),
        );
      },
    },
    workspaces: {
      async getById(id) { return spaces[id as keyof typeof spaces] ?? null; },
      async getMembership(workspaceId, userId) {
        const role = roles[userId]?.[workspaceId];
        return role ? { workspaceId, userId, role, displayName: null, email: null, avatarUrl: null } : null;
      },
      async listForUser(userId) {
        return Object.entries(roles[userId] ?? {}).map(([ws, role]) => ({ ...spaces[ws as keyof typeof spaces], role }));
      },
    },
    members: {
      async listByProject() {
        return ['coder', 'devlead'].map((userId) => ({ userId, user: { displayName: userId, avatarUrl: null } })) as never;
      },
      async findForProject(_p, userId) {
        return ['author', 'devlead', 'coder', 'manager'].includes(userId) ? ({ role: 'editor' } as never) : null;
      },
    },
    onChanged: (_projectId, ids) => { changed.push([...ids]); },
  });
  return { service, saved, changed };
}

test('get: the home lead manages and sees connectable workspaces; an editor only views', async () => {
  const { service } = make();
  const view = await service.get('p', 'devlead');
  assert.equal(view.canManage, true);
  assert.deepEqual(view.workspaces.map((w) => [w.id, w.connected, w.taskScope.kind]), [
    ['dev', true, 'all'],
    ['office', false, 'own'],
  ]);
  assert.equal((await service.get('p', 'coder')).canManage, false);
  await assert.rejects(service.get('p', 'stranger'), ProjectNotFoundError);
});

test('save: connect office with own tasks, programmers keep all; personal rules only for people with access', async () => {
  const { service, saved, changed } = make();
  await service.save('p', 'devlead', {
    workspaces: [{ workspaceId: 'office', taskScope: { kind: 'own' } }],
    members: [
      { userId: 'manager', taskScope: { kind: 'selected', from: ['dev', 'nowhere'] } },
      { userId: 'salesboss', taskScope: { kind: 'all' } },
    ],
  });
  assert.deepEqual(saved[0]!.workspaces, [
    { workspaceId: 'office', taskScope: { kind: 'own' } },
    { workspaceId: 'dev', taskScope: { kind: 'all' } },
  ]);
  assert.deepEqual(saved[0]!.members, [{ userId: 'manager', taskScope: { kind: 'selected', from: ['dev'] } }]);
  assert.deepEqual(changed[0]!.sort(), ['dev', 'office']);
});

test('save: only project admins; only team workspaces where the actor leads', async () => {
  const { service } = make();
  await assert.rejects(service.save('p', 'coder', { workspaces: [], members: [] }), ProjectSharingForbiddenError);
  await assert.rejects(
    service.save('p', 'devlead', { workspaces: [{ workspaceId: 'sales', taskScope: { kind: 'own' } }], members: [] }),
    ProjectSharingInvalidError,
  );
  await assert.rejects(
    service.save('p', 'devlead', { workspaces: [{ workspaceId: 'personal', taskScope: { kind: 'own' } }], members: [] }),
    ProjectSharingInvalidError,
  );
});

test('save: an already connected workspace stays even if the actor does not lead it', async () => {
  const { service, saved } = make({
    projectId: 'p',
    homeWorkspaceId: 'dev',
    creatorUserId: 'author',
    workspaces: [{ workspaceId: 'sales', taskScope: { kind: 'own' } }],
    members: [],
  });
  await service.save('p', 'devlead', { workspaces: [{ workspaceId: 'sales', taskScope: { kind: 'all' } }], members: [] });
  assert.equal(saved.length, 1);
});
