import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RunAiConversationRunWithLlm,
  type ClaimedAiConversationRun,
} from './RunAiConversationRunWithLlm.js';
import { aiConversationServerQueue, SERVER_AI_CONVERSATION_MODES } from './aiConversationServerQueue.js';
import { aiConversationActionProtocol } from './aiConversationWorkerInput.js';
import { AI_CONVERSATION_TEMPLATE } from './prompts/conversationPrompt.js';
import type { ServerQueuedAiConversationRun } from './AiConversationRepository.js';
import type { AiConversationService } from './AiConversationService.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type { AiConversationRun } from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationRunNotFoundError,
  AiConversationRunStateConflictError,
} from '../../domain/ai-conversation/errors.js';
import type { GenerateLlmTextInput, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';

type CompleteCall = Parameters<AiConversationService['completeRun']>[0];
type FailCall = Parameters<AiConversationService['failRun']>[0];
type ClaimCall = Parameters<AiConversationService['claimRun']>[0];

const NOW = new Date('2026-10-06T10:00:00.000Z');
const LEASE = 'lease-token-0123456789abcdef';
const SNAPSHOT = { conversationId: 'conversation-1', projectId: null, requestedAt: NOW.toISOString() };

function runFixture(patch: Partial<AiConversationRun> = {}): AiConversationRun {
  return {
    id: 'run-1', conversationId: 'conversation-1', projectId: null, dispatcherUserId: 'disp-1',
    userMessageId: 'm-user', assistantMessageId: 'm-assistant', mode: 'chat', status: 'running',
    contextVersion: 1, contextSnapshot: SNAPSHOT, idempotencyKey: 'request',
    completionIdempotencyKey: null, leaseTokenHash: 'hash', leaseExpiresAt: NOW, claimedAt: NOW,
    projectEditJobId: null, model: null, tokensIn: null, tokensOut: null, costUsd: null,
    errorCode: null, errorMessage: null, createdAt: NOW, startedAt: NOW, finishedAt: null,
    updatedAt: NOW, ...patch,
  };
}

function message(patch: Partial<AiConversationMessage>): AiConversationMessage {
  return {
    id: 'm-user', seq: 1, conversationId: 'conversation-1', role: 'user', status: 'completed',
    body: 'Привет', parentMessageId: null, clientRequestId: null, runId: null, model: null,
    metadata: null, errorCode: null, errorRetryable: false, deletedAt: null, createdAt: NOW,
    updatedAt: NOW, ...patch,
  };
}

function queued(runPatch: Partial<AiConversationRun> = {}): ServerQueuedAiConversationRun {
  return {
    run: runFixture({ status: 'queued', leaseTokenHash: null, leaseExpiresAt: null, ...runPatch }),
    conversationTitle: 'Новый чат',
    projectName: null,
    inputText: 'Привет',
    history: [message({})],
    ownerUserId: 'owner-1',
  };
}

function claimed(
  patch: Partial<ClaimedAiConversationRun> = {},
  runPatch: Partial<AiConversationRun> = {},
): ClaimedAiConversationRun {
  return { ...queued(), run: runFixture(runPatch), leaseToken: LEASE, ...patch };
}

function setup(reply: string | Error) {
  const completed: CompleteCall[] = [];
  const failed: FailCall[] = [];
  const calls: GenerateLlmTextInput[] = [];
  const conversations: Pick<AiConversationService, 'completeRun' | 'failRun'> = {
    async completeRun(input) {
      completed.push(input);
      return {} as never;
    },
    async failRun(input) {
      failed.push(input);
      return {} as never;
    },
  };
  const runner = new RunAiConversationRunWithLlm({
    conversations,
    llm: {
      async generate(input): Promise<GenerateLlmTextResult> {
        calls.push(input);
        if (reply instanceof Error) throw reply;
        return {
          text: reply,
          model: 'gpt-6.1-sol',
          usage: { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 300, reasoningTokens: 40 },
          costUsd: 0.0042,
        };
      },
    },
  });
  return { runner, conversations, completed, failed, calls };
}

// Заполнение шаблона так, как это делал воркер: последовательные .Replace().
function workerPrompt(values: [string, string][]): string {
  return values.reduce((out, [key, value]) => out.split(`{{${key}}}`).join(value), AI_CONVERSATION_TEMPLATE);
}

test('chat: промпт совпадает с тем, что собирал ai-conversation-worker.ps1', async () => {
  const { runner, calls } = setup('Ответ');
  await runner.execute(claimed());

  const safeContext = JSON.stringify(
    {
      project: SNAPSHOT,
      conversationHistory: [
        { id: 'm-user', seq: '1', role: 'user', status: 'completed', body: 'Привет', model: null, createdAt: NOW.toISOString() },
      ],
    },
    null,
    2,
  );
  assert.equal(
    calls[0]!.input,
    workerPrompt([
      ['CONVERSATION_TITLE', 'Новый чат'],
      ['PROJECT_NAME', '(personal chat)'],
      ['MODE', 'chat'],
      ['SAFE_CONTEXT', safeContext],
      ['INPUT_TEXT', 'Привет'],
    ]),
  );
  // В «Размышлении» прав на действия нет — протокол не добавляется.
  assert.doesNotMatch(calls[0]!.input, /SYSTEM CAPABILITY/);
  assert.equal(calls[0]!.billedUserId, 'owner-1');
  assert.equal(calls[0]!.tier, 'default');
  assert.ok(calls[0]!.timeoutMs < 5 * 60_000, 'ответ должен успеть до конца lease');
});

test('studio_plan: к сообщению добавлен протокол действий с id проекта, в промпте — имя проекта', async () => {
  const { runner, calls } = setup('План');
  await runner.execute(
    claimed({ projectName: 'Сайт', inputText: 'Создай три задачи' }, { mode: 'studio_plan', projectId: 'p-1' }),
  );
  const input = calls[0]!.input;
  assert.match(input, /\nПроект: Сайт\nРежим: studio_plan\n/);
  assert.ok(
    input.endsWith(`Сообщение пользователя:\nСоздай три задачи\n\n${aiConversationActionProtocol('p-1')}\n\n`),
  );
  assert.match(input, /Current project id: p-1\./);
});

test('ответ закрывает run тем же путём, что /complete: lease, ключ идемпотентности, модель, токены, стоимость', async () => {
  const { runner, completed, failed } = setup('  **Готово**  \n');
  await runner.execute(claimed());
  assert.equal(failed.length, 0);
  assert.deepEqual(completed, [
    {
      runId: 'run-1',
      dispatcherUserId: 'disp-1',
      leaseToken: LEASE,
      completionIdempotencyKey: 'complete-run-1',
      body: '**Готово**',
      model: 'gpt-6.1-sol',
      tokensIn: 1200,
      tokensOut: 300,
      costUsd: 0.0042,
      steps: null,
      knowledge: null,
      suggestions: null,
      requestId: null,
    },
  ]);
});

test('длинный ответ обрезается до 100 000 символов, как maxOutputChars воркера', async () => {
  const { runner, completed } = setup('я'.repeat(100_050));
  await runner.execute(claimed());
  assert.equal(completed[0]!.body.length, 100_000);
});

test('пустой ответ модели закрывает run ошибкой model_failed с возможностью повтора', async () => {
  const { runner, completed, failed } = setup('  \n ');
  await runner.execute(claimed());
  assert.equal(completed.length, 0);
  assert.deepEqual(failed, [
    {
      runId: 'run-1',
      dispatcherUserId: 'disp-1',
      leaseToken: LEASE,
      completionIdempotencyKey: 'fail-run-1',
      errorCode: 'model_failed',
      errorMessage: 'empty_response',
      retryable: true,
      requestId: null,
    },
  ]);
});

test('ошибка подписки — model_failed с причиной, обрезанной под колонку error_message', async () => {
  const { runner, failed } = setup(new Error('Достигнут лимит подписки ChatGPT — повторите позже.'));
  await runner.execute(claimed());
  assert.equal(failed[0]!.errorCode, 'model_failed');
  assert.equal(failed[0]!.errorMessage, 'Достигнут лимит подписки ChatGPT — повторите позже.');

  const long = setup(new Error('x'.repeat(2_000)));
  await long.runner.execute(claimed());
  assert.equal(long.failed[0]!.errorMessage.length, 500);
});

test('не удалось записать ответ — run закрывается как worker_error, как у воркера', async () => {
  const { runner, conversations, failed } = setup('Ответ');
  conversations.completeRun = async () => {
    throw new Error('Deadlock found when trying to get lock');
  };
  await runner.execute(claimed());
  assert.equal(failed[0]!.errorCode, 'worker_error');
  assert.equal(failed[0]!.errorMessage, 'Deadlock found when trying to get lock');
  assert.equal(failed[0]!.completionIdempotencyKey, 'fail-run-1');
});

test('отменённый run молча пропускается, а сбой записи ошибки уходит в лог очереди', async () => {
  const cancelled = setup('Ответ');
  cancelled.conversations.completeRun = async () => {
    throw new AiConversationRunStateConflictError('cancelled');
  };
  cancelled.conversations.failRun = async () => {
    throw new AiConversationRunStateConflictError('cancelled');
  };
  await assert.doesNotReject(() => cancelled.runner.execute(claimed()));

  const broken = setup(new Error('timeout'));
  broken.conversations.failRun = async () => {
    throw new Error('Connection lost');
  };
  await assert.rejects(() => broken.runner.execute(claimed()), /Connection lost/);
});

test('очередь: сервер берёт только chat и studio_plan и забирает run как его диспетчер', async () => {
  const listed: { modes: readonly string[]; limit: number }[] = [];
  const claims: ClaimCall[] = [];
  const executed: ClaimedAiConversationRun[] = [];
  const adapter = aiConversationServerQueue({
    runs: {
      async listQueuedForServer(input) {
        listed.push(input);
        return [
          queued({ id: 'run-a', dispatcherUserId: 'disp-a' }),
          queued({ id: 'run-b', dispatcherUserId: 'disp-b' }),
        ];
      },
    },
    conversations: {
      async claimRun(input) {
        claims.push(input);
        // run-b успел забрать диспетчер — claim его не отдаёт.
        if (input.runId === 'run-b') throw new AiConversationRunNotFoundError();
        return runFixture({
          id: input.runId,
          dispatcherUserId: input.dispatcherUserId,
          contextSnapshot: { source: 'claim' },
        });
      },
    },
    run: {
      async execute(c) {
        executed.push(c);
      },
    },
    now: () => NOW,
  });

  assert.equal(adapter.queue, 'ai_conversation');
  const tasks = await adapter.claim(3);
  assert.deepEqual(listed, [{ modes: ['chat', 'studio_plan'], limit: 3 }]);
  assert.equal(SERVER_AI_CONVERSATION_MODES.includes('studio_edit'), false);
  assert.deepEqual(
    claims.map((c) => [c.runId, c.dispatcherUserId]),
    [['run-a', 'disp-a'], ['run-b', 'disp-b']],
  );
  assert.equal(claims[0]!.leaseExpiresAt.getTime(), NOW.getTime() + 5 * 60_000);
  assert.ok(claims[0]!.leaseToken.length >= 20);
  assert.notEqual(claims[0]!.leaseToken, claims[1]!.leaseToken);

  assert.equal(tasks.length, 1);
  await tasks[0]!();
  // Исполнитель получает run после claim (снимок контекста — из него) и свой lease-токен.
  assert.deepEqual(executed[0]!.run.contextSnapshot, { source: 'claim' });
  assert.equal(executed[0]!.leaseToken, claims[0]!.leaseToken);
  assert.equal(executed[0]!.ownerUserId, 'owner-1');
  assert.equal(executed[0]!.inputText, 'Привет');
});
