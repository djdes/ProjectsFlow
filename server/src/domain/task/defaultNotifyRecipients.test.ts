import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultNotifyRecipientIds } from './defaultNotifyRecipients.js';

const base = {
  actorUserId: 'me',
  candidateUserIds: ['me', 'lead', 'owner', 'dev'],
  leadUserIds: ['lead'],
  ownerUserIds: ['owner'],
  assigneeUserId: 'me',
};

test('member comment defaults to the workspace lead', () => {
  assert.deepEqual(defaultNotifyRecipientIds(base), ['lead']);
});

test('without another lead the workspace owner is the default', () => {
  assert.deepEqual(defaultNotifyRecipientIds({ ...base, leadUserIds: [] }), ['owner']);
});

test('several leads are all selected', () => {
  assert.deepEqual(
    defaultNotifyRecipientIds({ ...base, leadUserIds: ['lead', 'dev'] }),
    ['lead', 'dev'],
  );
});

test('lead commenting defaults to the assignee, not to fellow managers', () => {
  assert.deepEqual(
    defaultNotifyRecipientIds({ ...base, actorUserId: 'lead', assigneeUserId: 'dev' }),
    ['dev'],
  );
});

test('owner commenting on his own task notifies nobody by default', () => {
  assert.deepEqual(
    defaultNotifyRecipientIds({ ...base, actorUserId: 'owner', assigneeUserId: 'owner' }),
    [],
  );
});

test('managers without task access are skipped', () => {
  assert.deepEqual(
    defaultNotifyRecipientIds({ ...base, candidateUserIds: ['me', 'owner'] }),
    ['owner'],
  );
});

test('without managers the assignee is the default', () => {
  assert.deepEqual(
    defaultNotifyRecipientIds({ ...base, leadUserIds: [], ownerUserIds: [], assigneeUserId: 'dev' }),
    ['dev'],
  );
});

test('nobody to notify yields an empty default', () => {
  assert.deepEqual(
    defaultNotifyRecipientIds({ ...base, candidateUserIds: ['me'], leadUserIds: [], ownerUserIds: ['me'] }),
    [],
  );
});
