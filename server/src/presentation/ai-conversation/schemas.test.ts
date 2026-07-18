import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createConversationSchema,
  listMessagesQuerySchema,
  sendMessageSchema,
} from './schemas.js';

test('create schema enforces the public conversation kinds', () => {
  assert.equal(createConversationSchema.parse({ kind: 'personal' }).kind, 'personal');
  assert.throws(() => createConversationSchema.parse({ kind: 'shared' }));
});

test('message pagination rejects ambiguous cursors', () => {
  assert.throws(() => listMessagesQuerySchema.parse({ beforeSeq: '10', afterSeq: '20' }));
  assert.deepEqual(listMessagesQuerySchema.parse({ afterSeq: '20', limit: '40' }), {
    afterSeq: 20,
    limit: 40,
  });
});

test('send schema requires a UUID idempotency key and bounded body', () => {
  const value = sendMessageSchema.parse({
    body: '  hello  ',
    clientRequestId: '00000000-0000-4000-8000-000000000099',
  });
  assert.equal(value.body, 'hello');
  assert.throws(() => sendMessageSchema.parse({ body: 'x', clientRequestId: 'not-a-uuid' }));
});
