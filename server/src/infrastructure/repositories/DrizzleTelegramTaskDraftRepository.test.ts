import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleTelegramTaskDraftRepository } from './DrizzleTelegramTaskDraftRepository.js';
import type { TelegramDraftAttachment } from '../../application/telegram/TelegramTaskDraftRepository.js';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    creatorUserId: 'user-1',
    tgChatId: 100,
    tgMessageId: 200,
    sourceKey: 'm:100:10',
    taskText: 'Task',
    projectId: null,
    assigneeUserId: null,
    delegationId: null,
    offered: null,
    segments: null,
    photos: null,
    attachments: null,
    targetStatus: null,
    status: 'composing',
    createdAt: new Date('2026-07-15T00:00:00Z'),
    autoCreateAt: null,
    confirmationStartedAt: null,
    expiresAt: new Date('2036-07-15T00:00:00Z'),
    ...overrides,
  };
}

function selectDb(results: unknown[][]) {
  let call = 0;
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return results[call++] ?? [];
                },
              };
            },
          };
        },
      };
    },
  };
}

test('legacy photos are lazily exposed as generalized attachments', async () => {
  const legacyPhoto = {
    fileId: 'photo-file',
    fileUniqueId: 'photo-unique',
    width: 1280,
    height: 720,
    fileSize: 42,
  };
  const db = selectDb([[row({ photos: JSON.stringify([legacyPhoto]), attachments: null })]]);
  const repo = new DrizzleTelegramTaskDraftRepository(db as never);

  const draft = await repo.findBySourceKey('m:100:10');

  assert.equal(draft?.attachments.length, 1);
  assert.deepEqual(draft?.attachments[0], {
    key: 'photo:photo-unique',
    kind: 'photo',
    fileId: 'photo-file',
    fileUniqueId: 'photo-unique',
    filename: 'telegram-photo-1.jpg',
    mimeType: 'image/jpeg',
    fileSize: 42,
    width: 1280,
    height: 720,
    duration: null,
    targetSegmentIndexes: [0],
  });
});

test('create dual-writes generalized attachments and the legacy photo projection', async () => {
  const attachment: TelegramDraftAttachment = {
    key: 'photo-unique',
    kind: 'photo',
    fileId: 'photo-file',
    fileUniqueId: 'photo-unique',
    filename: 'screen.jpg',
    mimeType: 'image/jpeg',
    fileSize: 42,
    width: 1280,
    height: 720,
    duration: null,
    targetSegmentIndexes: [0, 2],
  };
  let inserted: Record<string, unknown> | null = null;
  let selectCall = 0;
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  selectCall += 1;
                  return selectCall === 1 || !inserted ? [] : [row(inserted)];
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        async values(value: Record<string, unknown>) {
          inserted = value;
        },
      };
    },
  };
  const repo = new DrizzleTelegramTaskDraftRepository(db as never);

  const draft = await repo.create({
    id: 'draft-1',
    creatorUserId: 'user-1',
    tgChatId: 100,
    sourceKey: 'm:100:10',
    taskText: 'Task',
    attachments: [attachment],
    ttlSeconds: 600,
  });

  assert.deepEqual(inserted?.['attachments'], [attachment]);
  assert.deepEqual(inserted?.['photos'], [
    {
      fileId: 'photo-file',
      fileUniqueId: 'photo-unique',
      width: 1280,
      height: 720,
      fileSize: 42,
    },
  ]);
  assert.deepEqual(draft.attachments[0]?.targetSegmentIndexes, [0, 2]);
});

test('create returns the existing source draft without inserting again', async () => {
  let inserts = 0;
  const db = {
    ...selectDb([[row({ id: 'winner' })]]),
    insert() {
      inserts += 1;
      throw new Error('must not insert');
    },
  };
  const repo = new DrizzleTelegramTaskDraftRepository(db as never);

  const draft = await repo.create({
    id: 'loser',
    creatorUserId: 'user-1',
    tgChatId: 100,
    sourceKey: 'm:100:10',
    taskText: 'Task',
    ttlSeconds: 600,
  });

  assert.equal(draft.id, 'winner');
  assert.equal(inserts, 0);
});
