import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidates, neighborInviteSummary } from './neighborCandidates';
import type { InviteCandidate } from '@/domain/workspace/InviteCandidate';

const person = (userId: string, displayName: string, email: string, space: string): InviteCandidate => ({
  userId,
  displayName,
  email,
  avatarUrl: null,
  hasTelegram: false,
  workspaces: [{ id: space, name: space, icon: null }],
  invited: false,
});

const list = [person('a', 'Анна', 'anna@x.ru', 'Офис'), person('b', 'Борис', 'boris@x.ru', 'Программисты')];

test('filterCandidates: by name, email or workspace, case-insensitive', () => {
  assert.deepEqual(filterCandidates(list, 'АНН').map((c) => c.userId), ['a']);
  assert.deepEqual(filterCandidates(list, 'boris@').map((c) => c.userId), ['b']);
  assert.deepEqual(filterCandidates(list, 'офис').map((c) => c.userId), ['a']);
  assert.deepEqual(filterCandidates(list, '  ').map((c) => c.userId), ['a', 'b']);
  assert.deepEqual(filterCandidates(list, 'нет такого'), []);
});

test('neighborInviteSummary: counts sent and skipped', () => {
  assert.deepEqual(neighborInviteSummary(['queued', 'reused']), {
    kind: 'success',
    text: 'Отправили приглашений: 2 — почта, сайт и Telegram',
  });
  assert.equal(neighborInviteSummary(['queued', 'member']).kind, 'warning');
  assert.equal(neighborInviteSummary(['error']).kind, 'error');
});
