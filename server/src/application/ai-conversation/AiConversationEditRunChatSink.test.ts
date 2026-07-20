import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiConversation } from '../../domain/ai-conversation/AiConversation.js';
import type { AiSelectionRef } from '../../domain/ai-conversation/AiSelectionRef.js';
import {
  AiConversationEditRunChatSink,
  type EditRunConversations,
} from './AiConversationEditRunChatSink.js';
import type {
  CompleteAiRunForEditJobInput,
  FailAiRunForEditJobInput,
} from './AiConversationRepository.js';
import type { SendAiMessageInput } from './AiConversationService.js';

const NOW = new Date('2026-07-19T10:00:00.000Z');
const USER = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-000000000003';
const JOB = '00000000-0000-4000-8000-000000000007';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const selection: AiSelectionRef = {
  kind: 'site_element',
  route: '/pricing',
  selector: '[data-pf-id="hero-title"]',
  tagName: 'h1',
  label: 'Тарифы',
  artifactVersion: '2026-07-18T10:00:00.000Z',
  jobId: JOB,
};

// Узкий Pick-порт вместо всего сервиса: адаптеру нужны ровно четыре метода.
class FakeConversations implements EditRunConversations {
  readonly sent: { userId: string; conversationId: string; input: SendAiMessageInput }[] = [];
  readonly completed: CompleteAiRunForEditJobInput[] = [];
  readonly failed: FailAiRunForEditJobInput[] = [];
  studioLookups = 0;

  async getOrCreateProjectStudio(userId: string, projectId: string): Promise<AiConversation> {
    this.studioLookups += 1;
    return {
      id: `conversation-${projectId}`,
      ownerUserId: userId,
      workspaceId: null,
      projectId,
      kind: 'project_studio',
      title: 'Проект — ИИ',
      version: 1,
      lastMessageSeq: null,
      lastMessageAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  async sendMessage(userId: string, conversationId: string, input: SendAiMessageInput) {
    this.sent.push({ userId, conversationId, input });
    // Адаптер результат отправки не читает — сообщение уже в БД, дальше живёт run.
    return null as never;
  }

  async completeRunFromEditJob(input: CompleteAiRunForEditJobInput) {
    this.completed.push(input);
    return null;
  }

  async failRunFromEditJob(input: FailAiRunForEditJobInput) {
    this.failed.push(input);
    return null;
  }
}

function build() {
  const conversations = new FakeConversations();
  return { conversations, sink: new AiConversationEditRunChatSink({ conversations }) };
}

function open(sink: AiConversationEditRunChatSink, idempotencyKey: string) {
  return sink.openEditRun({
    projectId: PROJECT,
    userId: USER,
    jobId: JOB,
    idempotencyKey,
    prompt: 'Сделай заголовок крупнее',
    selection,
  });
}

test('edit prompt lands in the project studio as a studio_edit message with the zone attached', async () => {
  const { conversations, sink } = build();
  await open(sink, 'preview-ai-1111-2222');

  const [entry] = conversations.sent;
  assert.equal(conversations.studioLookups, 1);
  assert.equal(entry?.userId, USER);
  assert.equal(entry?.conversationId, `conversation-${PROJECT}`);
  assert.equal(entry?.input.body, 'Сделай заголовок крупнее');
  assert.equal(entry?.input.mode, 'studio_edit');
  assert.equal(entry?.input.projectEditJobId, JOB);
  assert.deepEqual(entry?.input.selection, selection);
});

test('the message request id is a UUID derived from the job key, so a retry is not a duplicate', async () => {
  const { conversations, sink } = build();
  await open(sink, 'preview-ai-1111-2222');
  await open(sink, 'preview-ai-1111-2222');
  await open(sink, 'preview-ai-3333-4444');

  const ids = conversations.sent.map((entry) => entry.input.clientRequestId);
  assert.match(ids[0] ?? '', UUID);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], ids[2]);
});

test('a malformed zone reference is dropped instead of poisoning the message metadata', async () => {
  const { conversations, sink } = build();
  await sink.openEditRun({
    projectId: PROJECT,
    userId: USER,
    jobId: JOB,
    idempotencyKey: 'preview-ai-1111-2222',
    prompt: 'Поправь блок',
    selection: { ...selection, selector: '   ' },
  });
  assert.equal(conversations.sent[0]?.input.selection, null);
});

test('a finished job returns the words of the AI and its steps into the same message', async () => {
  const { conversations, sink } = build();
  const steps = [
    { id: 'step-1', kind: 'read' as const, label: 'Изучение данных', detail: null, startedAt: null, durationMs: 12 },
  ];
  await sink.closeEditRun({ jobId: JOB, status: 'succeeded', summary: '  Увеличил кегль до 48px  ', steps });

  const [completion] = conversations.completed;
  assert.equal(completion?.projectEditJobId, JOB);
  assert.equal(completion?.body, 'Увеличил кегль до 48px');
  assert.deepEqual(completion?.steps, steps);
  assert.equal(completion?.completionIdempotencyKey, `edit-job:${JOB}`);
  assert.equal(conversations.failed.length, 0);
});

test('a worker that sends no summary still closes the message with a readable fallback', async () => {
  const { conversations, sink } = build();
  await sink.closeEditRun({ jobId: JOB, status: 'succeeded' });
  assert.match(conversations.completed[0]?.body ?? '', /Готово/);
  assert.equal(conversations.completed[0]?.steps, null);
});

test('a failed job closes the run as failed and retryable so the UI offers a retry', async () => {
  const { conversations, sink } = build();
  await sink.closeEditRun({ jobId: JOB, status: 'failed', error: 'worker did not report back' });

  const [failure] = conversations.failed;
  assert.equal(failure?.projectEditJobId, JOB);
  assert.equal(failure?.errorMessage, 'worker did not report back');
  assert.equal(failure?.retryable, true);
  assert.equal(conversations.completed.length, 0);
});

test('a failure without an error message still says something in Russian', async () => {
  const { conversations, sink } = build();
  await sink.closeEditRun({ jobId: JOB, status: 'failed', error: '   ' });
  assert.match(conversations.failed[0]?.errorMessage ?? '', /Не удалось/);
});
