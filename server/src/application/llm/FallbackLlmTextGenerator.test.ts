import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmRateLimitedError } from '../../domain/llm/errors.js';
import { liteComposeContext } from '../ai-prompt/liteComposeContext.js';
import { FallbackLlmTextGenerator } from './FallbackLlmTextGenerator.js';
import type { GenerateLlmText, GenerateLlmTextInput } from './LlmTextGenerator.js';

const input: GenerateLlmTextInput = {
  billedUserId: 'u1',
  tier: 'fast',
  instructions: 'инструкция',
  input: 'полный промпт',
  fallbackInput: 'короткий промпт',
  timeoutMs: 1000,
};

function generator(answer: () => Promise<string>, seen: GenerateLlmTextInput[] = []): GenerateLlmText {
  return {
    async generate(request) {
      seen.push(request);
      return { text: await answer(), model: 'm', usage: null, costUsd: null };
    },
  };
}

test('подписка ChatGPT в лимите — отвечает запасная модель, с коротким входом', async () => {
  // 15.10.2026: лимит подписки до 20.10 — бот ставил задачи без проекта и перефразирования.
  const seen: GenerateLlmTextInput[] = [];
  const llm = new FallbackLlmTextGenerator({
    primary: generator(() => Promise.reject(new LlmRateLimitedError(new Date('2026-10-20')))),
    fallback: generator(async () => '{"segments":[]}', seen),
  });
  const result = await llm.generate(input);
  assert.equal(result.text, '{"segments":[]}');
  assert.equal(seen[0]!.input, 'короткий промпт');
});

test('прочие ошибки и сбой запасной модели — наружу исходная причина', async () => {
  const other = new FallbackLlmTextGenerator({
    primary: generator(() => Promise.reject(new Error('bad json'))),
    fallback: generator(async () => 'не должен вызываться'),
  });
  await assert.rejects(other.generate(input), /bad json/);

  const limit = new LlmRateLimitedError(null);
  const both = new FallbackLlmTextGenerator({
    primary: generator(() => Promise.reject(limit)),
    fallback: generator(() => Promise.reject(new Error('Groq HTTP 413'))),
  });
  await assert.rejects(both.generate(input), (error) => error === limit);
});

test('сжатый контекст compose: проекты и участники без дайджестов и списков задач', () => {
  const block = [
    'Сегодня: 2026-10-15\n\n[projectId=p1] Magday_front\nПространство: MAG\nУчастники (варианты ответственного): [userId=u1] Олег\nОткрытые задачи (кандидаты на дополнение): [taskId=t1] Шрифт\nДлинный дайджест базы знаний…',
    '[projectId=p2] ScanFlow\nДайджест',
  ].join('\n\n---\n\n');
  const lite = liteComposeContext(block);
  assert.match(lite, /^Сегодня: 2026-10-15/);
  assert.match(lite, /\[projectId=p1\] Magday_front\nПространство: MAG\nУчастники .*\[userId=u1\] Олег/);
  assert.match(lite, /\[projectId=p2\] ScanFlow/);
  assert.doesNotMatch(lite, /taskId|дайджест|Дайджест/);
});
