import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunCommitSyncJobWithLlm, parseCommitSyncMatches } from './RunCommitSyncJobWithLlm.js';
import { COMMIT_SYNC_TEMPLATE } from './prompts/commitSyncPrompt.js';
import type { CompleteCommitSyncJobInput } from './CompleteCommitSyncJob.js';
import type { CommitSyncJob } from '../../domain/commit-sync/CommitSyncJob.js';
import type { GenerateLlmTextInput, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';

const CONTEXT = 'ЗАДАЧИ (колонка «Черновики»):\n1. taskId=t1 · статус=backlog\n   Экспорт в CSV\n\nКОММИТЫ:\n- sha=abc123 · feat: экспорт CSV';

function job(overrides: Partial<CommitSyncJob> = {}): CommitSyncJob {
  const now = new Date('2026-10-06T14:00:00Z');
  return {
    id: 'job-1',
    projectId: 'p1',
    createdBy: 'owner-1',
    dispatcherUserId: 'disp-1',
    status: 'running',
    action: 'propose',
    batchKey: null,
    thresholdHours: 24,
    context: CONTEXT,
    commitsJson: '{}',
    matchesJson: null,
    reviewJson: null,
    resultSummary: null,
    error: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    claimedAt: now,
    finishedAt: null,
    batchFlushedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup(reply: string | Error) {
  const completions: CompleteCommitSyncJobInput[] = [];
  const calls: GenerateLlmTextInput[] = [];
  const runner = new RunCommitSyncJobWithLlm({
    complete: { execute: async (input) => void completions.push(input) },
    llm: {
      async generate(input): Promise<GenerateLlmTextResult> {
        calls.push(input);
        if (reply instanceof Error) throw reply;
        return {
          text: reply,
          model: 'gpt-6-luna',
          usage: { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 80, reasoningTokens: 30 },
          costUsd: 0.0021,
        };
      },
    },
  });
  return { runner, completions, calls };
}

test('промпт: контекст job’а подставляется в шаблон воркера, запрос — на быструю модель от плательщика', async () => {
  const { runner, calls } = setup('{"matches":[]}');
  await runner.execute(job());
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.input, COMMIT_SYNC_TEMPLATE.replace('{{CONTEXT}}', CONTEXT));
  assert.ok(calls[0]!.input.endsWith(`ДАННЫЕ:\n\n${CONTEXT}\n`));
  assert.equal(calls[0]!.billedUserId, 'owner-1');
  assert.equal(calls[0]!.tier, 'fast');
  // Укладываемся в окно очистки (батч — 12 минут без активности, одиночный — 15 минут).
  assert.ok(calls[0]!.timeoutMs > 0 && calls[0]!.timeoutMs <= 180_000);
});

test('промпт: пустой контекст подменяется пометкой, у старого job’а без createdBy платит диспетчер', async () => {
  for (const context of [null, '  \n ']) {
    const { runner, calls } = setup('{"matches":[]}');
    await runner.execute(job({ context, createdBy: null }));
    assert.ok(calls[0]!.input.endsWith('ДАННЫЕ:\n\n(контекст пуст)\n'));
    assert.ok(!calls[0]!.input.includes('{{CONTEXT}}'));
    assert.equal(calls[0]!.billedUserId, 'disp-1');
  }
});

test('успех: совпадения из ```json-обёртки уходят в CompleteCommitSyncJob от имени диспетчера', async () => {
  const reply =
    'Вот результат:\n```json\n{"matches":[{"taskId":"t1","commitSha":"abc123","reason":"реализует экспорт"},' +
    '{"taskId":"t2","commitSha":"def456","reason":""}]}\n```';
  const { runner, completions } = setup(reply);
  await runner.execute(job());
  assert.deepEqual(completions, [
    {
      userId: 'disp-1',
      jobId: 'job-1',
      ok: true,
      matches: [
        { taskId: 't1', commitSha: 'abc123', reason: 'реализует экспорт' },
        { taskId: 't2', commitSha: 'def456', reason: null },
      ],
      error: null,
      costUsd: 0.0021,
      tokensIn: 1200,
      tokensOut: 80,
      model: 'gpt-6-luna',
    },
  ]);
});

test('успех без совпадений: {"matches":[]} — ok=true с пустым списком', async () => {
  const { runner, completions } = setup('{"matches":[]}');
  await runner.execute(job());
  assert.equal(completions[0]!.ok, true);
  assert.deepEqual(completions[0]!.matches, []);
  assert.equal(completions[0]!.error, null);
});

test('неразборчивый ответ: job падает с кодом воркера, потраченные токены всё равно метерятся', async () => {
  const cases: Array<[string, string]> = [
    ['Совпадений не нашёл.', 'parse_failed:no_json'],
    ['{"matches":[{"taskId":"t1",}]}', 'parse_failed:bad_json'],
  ];
  for (const [reply, error] of cases) {
    const { runner, completions } = setup(reply);
    await runner.execute(job());
    assert.equal(completions.length, 1);
    assert.equal(completions[0]!.ok, false);
    assert.equal(completions[0]!.matches, null);
    assert.equal(completions[0]!.error, error);
    assert.equal(completions[0]!.costUsd, 0.0021);
    assert.equal(completions[0]!.tokensOut, 80);
  }
});

test('пустой ответ модели — llm_failed: empty_output (у воркера claude_failed:empty_stdout)', async () => {
  const { runner, completions } = setup('  \n');
  await runner.execute(job());
  assert.equal(completions[0]!.ok, false);
  assert.equal(completions[0]!.error, 'llm_failed: empty_output');
});

test('ошибка модели: job завершается ok=false с причиной и без расхода', async () => {
  const { runner, completions } = setup(new Error('Достигнут лимит подписки ChatGPT — повторите позже.'));
  await runner.execute(job());
  assert.deepEqual(completions, [
    {
      userId: 'disp-1',
      jobId: 'job-1',
      ok: false,
      matches: null,
      error: 'llm_failed: Достигнут лимит подписки ChatGPT — повторите позже.',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      model: null,
    },
  ]);
});

test('сбой завершения на успехе не маскируется вторым complete(ok=false) — как у воркера', async () => {
  let attempts = 0;
  const runner = new RunCommitSyncJobWithLlm({
    complete: {
      async execute() {
        attempts++;
        throw new Error('Commit sync job job-1 cannot be completed - current status: cancelled');
      },
    },
    llm: {
      async generate(): Promise<GenerateLlmTextResult> {
        return { text: '{"matches":[]}', model: 'gpt-6-luna', usage: null, costUsd: null };
      },
    },
  });
  await assert.rejects(runner.execute(job()), /current status: cancelled/);
  assert.equal(attempts, 1);
});

test('Parse-Matches: обёртки, текст вокруг JSON и коды ошибок — как в воркере', () => {
  const one = '{"matches":[{"taskId":"t1","commitSha":"abc","reason":"r"}]}';
  const expected = { ok: true, matches: [{ taskId: 't1', commitSha: 'abc', reason: 'r' }] };
  assert.deepEqual(parseCommitSyncMatches(one), expected);
  assert.deepEqual(parseCommitSyncMatches('```json\n' + one + '\n```'), expected);
  // -replace в PowerShell регистронезависим.
  assert.deepEqual(parseCommitSyncMatches('```JSON\n' + one + '\n```'), expected);
  assert.deepEqual(parseCommitSyncMatches('Ответ:\n```json\n' + one + '\n```\nГотово'), expected);
  // Только закрывающий забор: срез даёт пустоту — берётся исходный текст.
  assert.deepEqual(parseCommitSyncMatches(one + '\n```'), expected);
  assert.deepEqual(parseCommitSyncMatches('Ответ: ' + one + ' конец'), expected);
  // Из двух блоков берётся первый.
  assert.deepEqual(parseCommitSyncMatches('```json\n{"matches":[]}\n```\n```json\n' + one + '\n```'), {
    ok: true,
    matches: [],
  });

  assert.deepEqual(parseCommitSyncMatches(' \n '), { ok: false, reason: 'empty' });
  assert.deepEqual(parseCommitSyncMatches('нет json'), { ok: false, reason: 'no_json' });
  assert.deepEqual(parseCommitSyncMatches('```json\n```'), { ok: false, reason: 'no_json' });
  // ``` внутри строки JSON режет ответ так же, как у воркера.
  assert.deepEqual(parseCommitSyncMatches('{"matches":[{"taskId":"t","commitSha":"s","reason":"a ```x``` b"}]}'), {
    ok: false,
    reason: 'no_json',
  });
  assert.deepEqual(parseCommitSyncMatches('{bad json}'), { ok: false, reason: 'bad_json' });
  assert.deepEqual(parseCommitSyncMatches(one + ' и ещё }'), { ok: false, reason: 'bad_json' });
  assert.deepEqual(parseCommitSyncMatches('{"matches":[{"taskId":"t","commitSha":"s"}]'), {
    ok: false,
    reason: 'bad_json',
  });
});

test('Parse-Matches: семантика PowerShell для полей и значений', () => {
  const parse = (json: string) => parseCommitSyncMatches(json);
  // Нет matches / null / строка вместо списка — «совпадений нет», а не ошибка.
  for (const json of ['{}', '{"foo":1}', '{"matches":null}', '{"matches":"str"}', '[{"taskId":"t","commitSha":"s"}]']) {
    assert.deepEqual(parse(json), { ok: true, matches: [] }, json);
  }
  // Одиночный объект вместо списка — список из одного элемента.
  assert.deepEqual(parse('{"matches":{"taskId":"t1","commitSha":"s1"}}'), {
    ok: true,
    matches: [{ taskId: 't1', commitSha: 's1', reason: null }],
  });
  // Ключи без учёта регистра.
  assert.deepEqual(parse('{"Matches":[{"TaskId":"t1","CommitSHA":"s1","Reason":"x"}]}'), {
    ok: true,
    matches: [{ taskId: 't1', commitSha: 's1', reason: 'x' }],
  });
  // Пропускаются элементы без taskId/commitSha и с ложными значениями; ложный reason → null.
  assert.deepEqual(
    parse(
      '{"matches":[{"taskId":"","commitSha":"s"},{"taskId":"t"},null,5,"str",true,' +
        '{"taskId":1,"commitSha":0},{"taskId":"t3","commitSha":"s3","reason":false}]}',
    ),
    { ok: true, matches: [{ taskId: 't3', commitSha: 's3', reason: null }] },
  );
  // [string] от скаляров: числа строкой, true → 'True'; непустая строка истинна даже '0'.
  assert.deepEqual(parse('{"matches":[{"taskId":123,"commitSha":true,"reason":7},{"taskId":"0","commitSha":"False"}]}'), {
    ok: true,
    matches: [
      { taskId: '123', commitSha: 'True', reason: '7' },
      { taskId: '0', commitSha: 'False', reason: null },
    ],
  });
  // Ключи, отличающиеся только регистром (на любом уровне), и пустой ключ ConvertFrom-Json не принимает.
  assert.deepEqual(parse('{"matches":[{"taskId":"t","taskid":"u","commitSha":"s"}]}'), { ok: false, reason: 'bad_json' });
  assert.deepEqual(parse('{"a":1,"A":2,"matches":[]}'), { ok: false, reason: 'bad_json' });
  assert.deepEqual(parse('{"matches":[], "": 1}'), { ok: false, reason: 'bad_json' });
  // Точный дубль ключа — побеждает последний.
  assert.deepEqual(parse('{"matches":[{"taskId":"t","taskId":"u","commitSha":"s"}]}'), {
    ok: true,
    matches: [{ taskId: 'u', commitSha: 's', reason: null }],
  });
  // Сырые переводы строк/табы внутри строк и \' PowerShell принимал — принимаем и мы.
  assert.deepEqual(parse('{"matches":[{"taskId":"t","commitSha":"s","reason":"строка 1\nстрока\t2 it\\\'s"}]}'), {
    ok: true,
    matches: [{ taskId: 't', commitSha: 's', reason: "строка 1\nстрока\t2 it's" }],
  });
  // reason длиннее лимита agent-роута обрезается, а не валит прогон.
  const long = 'я'.repeat(2_500);
  const parsed = parse(`{"matches":[{"taskId":"t","commitSha":"s","reason":"${long}"}]}`);
  assert.equal(parsed.ok && parsed.matches[0]!.reason!.length, 2_000);
});
