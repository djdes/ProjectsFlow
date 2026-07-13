import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceForNewProject } from './resolveWorkspaceForNewProject.js';

type Kind = 'default' | 'team' | null;

function makeDeps(over: {
  current?: string | null;
  kinds?: Record<string, Kind>;
  soleTeam?: string | null;
  another?: string | null;
}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      getCurrentWorkspaceId: async (_userId: string) => {
        calls.push('getCurrentWorkspaceId');
        return over.current ?? null;
      },
      getWorkspaceKind: async (workspaceId: string) => {
        calls.push('getWorkspaceKind');
        return over.kinds?.[workspaceId] ?? null;
      },
      findSoleTeamWorkspaceForUser: async (_userId: string) => {
        calls.push('findSoleTeamWorkspaceForUser');
        return over.soleTeam ?? null;
      },
      findAnotherForUser: async (_userId: string) => {
        calls.push('findAnotherForUser');
        return over.another ?? null;
      },
    },
  };
}

test('current — команда → берём current как есть', async () => {
  const { deps } = makeDeps({ current: 'w-team', kinds: { 'w-team': 'team' } });
  const id = await resolveWorkspaceForNewProject(deps, 'u1');
  assert.equal(id, 'w-team');
});

test('current — личный дефолт-хаб + РОВНО одно team-пространство → уводим в team', async () => {
  const { deps } = makeDeps({
    current: 'w-default',
    kinds: { 'w-default': 'default' },
    soleTeam: 'w-team-1',
  });
  const id = await resolveWorkspaceForNewProject(deps, 'u1');
  assert.equal(id, 'w-team-1');
});

test('current — личный дефолт-хаб, нет team-пространств (соло-юзер) → остаёмся в хабе', async () => {
  const { deps } = makeDeps({
    current: 'w-default',
    kinds: { 'w-default': 'default' },
    soleTeam: null,
  });
  const id = await resolveWorkspaceForNewProject(deps, 'u1');
  assert.equal(id, 'w-default');
});

test('current — личный дефолт-хаб, >1 team-пространств (неоднозначность) → остаёмся в хабе', async () => {
  // findSoleTeamWorkspaceForUser возвращает null при >1 — не угадываем.
  const { deps } = makeDeps({
    current: 'w-default',
    kinds: { 'w-default': 'default' },
    soleTeam: null,
  });
  const id = await resolveWorkspaceForNewProject(deps, 'u1');
  assert.equal(id, 'w-default');
});

test('нет current, есть другое пространство → берём его', async () => {
  const { deps } = makeDeps({ current: null, another: 'w-any' });
  const id = await resolveWorkspaceForNewProject(deps, 'u1');
  assert.equal(id, 'w-any');
});

test('нет current и нет другого пространства → кидает ошибку (инвариант нарушен)', async () => {
  const { deps } = makeDeps({ current: null, another: null });
  await assert.rejects(
    () => resolveWorkspaceForNewProject(deps, 'u1'),
    /has no workspace/,
  );
});
