import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDraftWorkspaceWithAi } from './pickDraftWorkspaceWithAi.js';
import type { WorkspaceOption } from './resolveDraftWorkspace.js';
import type { GenerateLlmText } from '../../llm/LlmTextGenerator.js';

const SPACE_ME: WorkspaceOption = { id: 'w-me', name: 'Личное', icon: '🔥', kind: 'default' };
const SPACE_MAG: WorkspaceOption = { id: 'w-mag', name: 'MAG Сайты/Скрипты', icon: 'M', kind: 'team' };
const SPACE_SUB: WorkspaceOption = { id: 'w-sub', name: 'SUB Сайты/Скрипты', icon: '🟡', kind: 'team' };

function fakeLlm(replyText: string | (() => Promise<string>)): {
  llm: GenerateLlmText;
  prompts: string[];
} {
  const prompts: string[] = [];
  return {
    prompts,
    llm: {
      generate: async (input) => {
        prompts.push(input.input);
        const text = typeof replyText === 'function' ? await replyText() : replyText;
        return { text, model: 'test-model', usage: null, costUsd: null };
      },
    },
  };
}

test('пустой список вариантов — возвращает null', async () => {
  const res = await pickDraftWorkspaceWithAi(
    {},
    { billedUserId: 'u1', options: [], isGroupChat: false, tasksText: 'Проверка' },
  );
  assert.equal(res, null);
});

test('единственный вариант — выбирается сразу без вызова LLM', async () => {
  const { llm, prompts } = fakeLlm('{"workspaceId":"w-mag","reason":"unused"}');
  const res = await pickDraftWorkspaceWithAi(
    { llm },
    { billedUserId: 'u1', options: [SPACE_MAG], isGroupChat: false, tasksText: 'Проверка' },
  );
  assert.deepEqual(res, { workspaceId: 'w-mag', source: 'single', reason: 'only_option' });
  assert.equal(prompts.length, 0);
});

test('AI выбирает командное пространство по проектам и контексту задачи', async () => {
  const { llm, prompts } = fakeLlm(
    '{"workspaceId":"w-sub","reason":"Упоминается сэндвич-меню и доставка Subexpress"}',
  );
  const projects = new Map<string, readonly string[]>([
    ['w-mag', ['ScanFlow', 'OrdersFlow', 'Magday_front']],
    ['w-sub', ['Subexpress.ru', 'Snack-box.ru']],
  ]);
  const res = await pickDraftWorkspaceWithAi(
    { llm },
    {
      billedUserId: 'u1',
      options: [SPACE_ME, SPACE_MAG, SPACE_SUB],
      isGroupChat: false,
      projectsByWorkspaceId: projects,
      tasksText: 'Добавить баннер акции на сэндвичи на главной',
    },
  );
  assert.equal(res?.workspaceId, 'w-sub');
  assert.equal(res?.source, 'ai');
  assert.match(prompts[0]!, /Subexpress\.ru/);
  assert.match(prompts[0]!, /ScanFlow/);
});

test('если AI вернул чужой id вне кандидатов — срабатывает умный фолбэк', async () => {
  const { llm } = fakeLlm('{"workspaceId":"w-hallucinated","reason":"oops"}');
  const res = await pickDraftWorkspaceWithAi(
    { llm },
    {
      billedUserId: 'u1',
      options: [SPACE_MAG, SPACE_SUB],
      isGroupChat: false,
      delegateNames: ['Вася'],
      delegatedPreferredWorkspaceIds: ['w-sub'],
      tasksText: 'Проверить форму обратной связи',
    },
  );
  assert.deepEqual(res, {
    workspaceId: 'w-sub',
    source: 'fallback',
    reason: 'delegate_active_workspace',
  });
});

test('при сбое LLM фолбэк учитывает соседние сегменты и личное пространство', async () => {
  const { llm } = fakeLlm(async () => {
    throw new Error('rate_limited');
  });

  // Соседняя задача в этом же сообщении уже попала в проект из w-mag:
  const bySibling = await pickDraftWorkspaceWithAi(
    { llm },
    {
      billedUserId: 'u1',
      options: [SPACE_ME, SPACE_MAG, SPACE_SUB],
      isGroupChat: false,
      siblingProjectWorkspaceIds: ['w-mag'],
      tasksText: 'И ещё проверить логи на сервере',
    },
  );
  assert.deepEqual(bySibling, {
    workspaceId: 'w-mag',
    source: 'fallback',
    reason: 'sibling_project_workspace',
  });

  // Бытовая задача без соседних проектов при недоступном LLM уходит в «Личное»:
  const personal = await pickDraftWorkspaceWithAi(
    { llm },
    {
      billedUserId: 'u1',
      options: [SPACE_ME, SPACE_MAG],
      isGroupChat: false,
      tasksText: 'Купить кофе домой',
    },
  );
  assert.deepEqual(personal, {
    workspaceId: 'w-me',
    source: 'fallback',
    reason: 'personal_default',
  });
});
