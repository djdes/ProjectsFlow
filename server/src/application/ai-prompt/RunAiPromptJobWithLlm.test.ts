import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunAiPromptJobWithLlm, isTasksFlowEnvelope, parseComposeJson } from './RunAiPromptJobWithLlm.js';
import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import type { GenerateLlmTextInput, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';

type Completion = {
  userId: string;
  jobId: string;
  ok: boolean;
  improvedText: string | null;
  error: string | null;
  costUsd?: number | null;
  tokensIn?: number | null;
};

function job(overrides: Partial<AiPromptJob>): AiPromptJob {
  const now = new Date('2026-10-06T10:00:00Z');
  return {
    id: 'job-1',
    createdBy: 'user-1',
    projectId: 'p1',
    dispatcherUserId: 'disp-1',
    status: 'running',
    mode: 'improve',
    inputText: 'починить меню',
    kbContext: null,
    improvedText: null,
    error: null,
    claimedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup(reply: string | ((input: GenerateLlmTextInput) => string), bundles: { projectId: string; name: string; kb: string | null }[] = []) {
  const completions: Completion[] = [];
  const calls: GenerateLlmTextInput[] = [];
  const runner = new RunAiPromptJobWithLlm({
    complete: { execute: async (c) => void completions.push(c as Completion) },
    llm: {
      async generate(input): Promise<GenerateLlmTextResult> {
        calls.push(input);
        return {
          text: typeof reply === 'function' ? reply(input) : reply,
          model: 'gpt-6-luna',
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 },
          costUsd: 0.001,
        };
      },
    },
    loadKbBundles: async () => bundles,
  });
  return { runner, completions, calls };
}

test('improve: KB-блок и черновик подставляются в промпт, текст уходит в improvedText', async () => {
  const { runner, completions, calls } = setup('  Починить **меню**  ');
  await runner.execute(job({ kbContext: 'Термины проекта' }));
  assert.match(calls[0]!.input, /Контекст проекта \(база знаний\):\nТермины проекта/);
  assert.match(calls[0]!.input, /Черновик задачи:\nпочинить меню/);
  assert.equal(calls[0]!.billedUserId, 'user-1');
  assert.equal(completions[0]!.userId, 'disp-1');
  assert.equal(completions[0]!.jobId, 'job-1');
  assert.equal(completions[0]!.ok, true);
  assert.equal(completions[0]!.improvedText, 'Починить **меню**');
  assert.equal(completions[0]!.costUsd, 0.001);
  assert.equal(completions[0]!.tokensIn, 100);
});

test('compose: JSON из ответа в markdown-заборе превращается в нормализованные сегменты', async () => {
  const reply = '```json\n{"segments":[{"id":"s1","title":"Меню","simpleBody":"Починить","projectId":"p1","projectName":"Сайт","confidence":"0.8"}]}\n```';
  const { runner, completions, calls } = setup(reply);
  await runner.execute(job({ mode: 'compose', kbContext: 'кандидаты' }));
  assert.equal(calls[0]!.tier, 'fast');
  const result = JSON.parse(completions[0]!.improvedText!);
  assert.deepEqual(result, {
    version: 1,
    mode: 'compose',
    segments: [
      {
        id: 's1',
        title: 'Меню',
        simpleBody: 'Починить',
        projectId: 'p1',
        projectName: 'Сайт',
        confidence: 0.8,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
        taskType: null,
        existingTaskId: null,
        sourceExcerpt: null,
      },
    ],
  });
});

test('compose: результат разбирается Telegram-композером, поля задачи не теряются', async () => {
  const { parseComposeSegments } = await import('../telegram/composer/parseComposeSegments.js');
  const reply = JSON.stringify({
    version: 1,
    segments: [
      {
        id: 's1', title: 'Починить меню', simpleBody: 'Меню не открывается на iPhone', projectId: 'p1',
        projectName: 'Сайт', confidence: 0.9, assigneeUserId: 'u7', assigneeName: 'Иван',
        deadline: '2026-10-10', taskType: 'bug', existingTaskId: null,
        sourceExcerpt: 'Ваня, меню на айфоне не открывается, глянь до пятницы',
      },
      {
        id: 's2', title: 'Добавить скидку', simpleBody: 'Ещё скидка 10% на доставку', projectId: 'p1',
        projectName: 'Сайт', confidence: 0.7, assigneeUserId: null, assigneeName: null,
        deadline: null, taskType: 'feature', existingTaskId: 't42', sourceExcerpt: 'и скидку 10% на доставку',
      },
    ],
  });
  const { runner, completions } = setup(reply);
  await runner.execute(job({ mode: 'compose', kbContext: 'кандидаты' }));
  const segments = parseComposeSegments(completions[0]!.improvedText!);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.title, 'Починить меню');
  assert.equal(segments[0]!.body, 'Меню не открывается на iPhone');
  assert.equal(segments[0]!.assigneeUserId, 'u7');
  assert.equal(segments[0]!.deadline, '2026-10-10');
  assert.equal(segments[0]!.taskType, 'bug');
  assert.equal(segments[0]!.sourceExcerpt, 'Ваня, меню на айфоне не открывается, глянь до пятницы');
  assert.equal(segments[1]!.existingTaskId, 't42');
  assert.equal(segments[1]!.taskType, 'feature');
});

test('compose: ответ без segments — задание падает с понятным кодом', async () => {
  const { runner, completions } = setup('не JSON');
  await runner.execute(job({ mode: 'compose' }));
  assert.equal(completions[0]!.ok, false);
  assert.equal(completions[0]!.error, 'compose_pass1_bad_json');
});

test('compose-advanced: KB проектов в промпте, пропущенный сегмент берёт simpleBody', async () => {
  const input = JSON.stringify({
    segments: [
      { id: 's1', title: 'A', simpleBody: 'простой A', projectId: 'p1', projectName: 'Сайт' },
      { id: 's2', title: 'B', simpleBody: 'простой B', projectId: 'p2', projectName: 'Бот' },
    ],
  });
  const { runner, completions, calls } = setup('{"segments":[{"id":"s1","advancedBody":"подробно A"}]}', [
    { projectId: 'p1', name: 'Сайт', kb: 'KB сайта' },
  ]);
  await runner.execute(job({ mode: 'compose-advanced', inputText: input }));
  assert.match(calls[0]!.input, /### Проект: Сайт \[projectId=p1\]\nKB сайта/);
  assert.deepEqual(JSON.parse(completions[0]!.improvedText!), {
    version: 1,
    mode: 'compose-advanced',
    segments: [
      { id: 's1', advancedBody: 'подробно A' },
      { id: 's2', advancedBody: 'простой B' },
    ],
  });
});

test('TasksFlow: конверт опознаётся по app, участники и день недели — в промпте', async () => {
  const envelope = JSON.stringify({
    app: 'tasksflow',
    v: 1,
    today: '2026-10-06',
    dow: 2,
    author: { name: 'Олег', role: 'руководитель' },
    members: [{ id: 7, name: 'Иван', position: 'повар' }],
    categories: ['Кухня'],
    hasPhotos: true,
    message: 'Иван, помой плиту',
  });
  assert.equal(isTasksFlowEnvelope(envelope), true);
  const { runner, completions, calls } = setup('{"segments":[{"title":"Помыть плиту","assigneeId":7}]}');
  await runner.execute(job({ inputText: envelope }));
  assert.match(calls[0]!.input, /- id=7: Иван — повар/);
  assert.match(calls[0]!.input, /вторник/);
  assert.equal(completions[0]!.ok, true);
  assert.deepEqual(JSON.parse(completions[0]!.improvedText!), {
    segments: [{ title: 'Помыть плиту', assigneeId: 7 }],
  });
});

test('ошибка модели завершает задание как failed с причиной', async () => {
  const runner = new RunAiPromptJobWithLlm({
    complete: { execute: async (c) => void completions.push(c as Completion) },
    llm: {
      async generate(): Promise<GenerateLlmTextResult> {
        throw new Error('Достигнут лимит подписки ChatGPT');
      },
    },
    loadKbBundles: async () => [],
  });
  const completions: Completion[] = [];
  await runner.execute(job({}));
  assert.equal(completions[0]!.ok, false);
  assert.equal(completions[0]!.error, 'llm_failed: Достигнут лимит подписки ChatGPT');
});

test('parseComposeJson: пустые segments и мусор отвергаются', () => {
  assert.equal(parseComposeJson('{"segments":[]}'), null);
  assert.equal(parseComposeJson(''), null);
  assert.ok(parseComposeJson('Вот JSON: {"segments":[{"id":"a"}]} готово'));
  assert.equal(isTasksFlowEnvelope('{"app":"other"}'), false);
  assert.equal(isTasksFlowEnvelope('просто текст'), false);
});

test('задание, снятое по таймауту, не перезаписывается и не падает', async () => {
  const { AiPromptJobNotInRunningStateError } = await import('../../domain/ai-prompt/errors.js');
  let calls = 0;
  const runner = new RunAiPromptJobWithLlm({
    complete: {
      execute: async () => {
        calls++;
        throw new AiPromptJobNotInRunningStateError('job-1', 'cancelled');
      },
    },
    llm: {
      async generate(): Promise<GenerateLlmTextResult> {
        return { text: 'текст', model: 'gpt-6-luna', usage: null, costUsd: null };
      },
    },
    loadKbBundles: async () => [],
  });
  await runner.execute(job({}));
  assert.equal(calls, 1);
});
