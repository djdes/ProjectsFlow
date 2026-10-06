import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunMonitoringAnalysisJobWithLlm, buildMonitoringAnalysisPrompt } from './RunMonitoringAnalysisJobWithLlm.js';
import { CompleteMonitoringAnalysisJob, type CompleteMonitoringAnalysisJobInput } from './CompleteMonitoringAnalysisJob.js';
import type { MonitoringAnalysisJobRepository } from './MonitoringAnalysisJobRepository.js';
import { MONITORING_ANALYSIS_TEMPLATE } from './prompts/monitoringAnalysisPrompt.js';
import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import { MonitoringAnalysisJobNotInRunningStateError } from '../../domain/monitoring-analysis/errors.js';
import type { GenerateLlmTextInput, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';
import type { RecordUsage, RecordUsageInput } from '../usage/RecordUsage.js';

const CONTEXT = '# Сервер: web (vps)\nСтатус: degraded';
const USAGE = { inputTokens: 5000, cachedInputTokens: 1000, outputTokens: 700, reasoningTokens: 300 };

function job(overrides: Partial<MonitoringAnalysisJob> = {}): MonitoringAnalysisJob {
  const now = new Date('2026-10-06T10:00:00Z');
  return {
    id: 'job-1',
    createdBy: 'user-1',
    projectId: 'p1',
    serverId: 's1',
    dispatcherUserId: 'disp-1',
    status: 'running',
    analysisType: 'snapshot',
    alertId: null,
    context: CONTEXT,
    note: null,
    resultMarkdown: null,
    error: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    claimedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function reply(text: string): GenerateLlmTextResult {
  return { text, model: 'gpt-6.1-sol', usage: USAGE, costUsd: 0.0123 };
}

function setup(answer: string | Error) {
  const completions: CompleteMonitoringAnalysisJobInput[] = [];
  const calls: GenerateLlmTextInput[] = [];
  const runner = new RunMonitoringAnalysisJobWithLlm({
    complete: { execute: async (input) => void completions.push(input) },
    llm: {
      async generate(input) {
        calls.push(input);
        if (answer instanceof Error) throw answer;
        return reply(answer);
      },
    },
  });
  return { runner, completions, calls };
}

test('промпт: тип анализа, заметка отдельным блоком и контекст — как в воркере', () => {
  const prompt = buildMonitoringAnalysisPrompt({ analysisType: 'logs', note: 'почему 502?', context: CONTEXT });
  const expected = MONITORING_ANALYSIS_TEMPLATE.replace('{{ANALYSIS_TYPE}}', 'logs')
    .replace('{{NOTE_BLOCK}}', 'Вопрос/заметка пользователя: почему 502?\n\n')
    .replace('{{CONTEXT}}', CONTEXT);
  assert.equal(prompt, expected);
  assert.match(prompt, /^Тип анализа: logs$/m);
  assert.match(prompt, /Вопрос\/заметка пользователя: почему 502\?\n\nПравила ответа:/);
  assert.ok(prompt.endsWith(`ДАННЫЕ МОНИТОРИНГА:\n\n${CONTEXT}\n`));
});

test('промпт: пустая заметка — без блока, пустой контекст — заглушка', () => {
  const blank = buildMonitoringAnalysisPrompt({ analysisType: 'snapshot', note: '  ', context: ' \n ' });
  assert.match(blank, /\(snapshot — общая диагностика[^\n]*\)\n\nПравила ответа:/);
  assert.doesNotMatch(blank, /Вопрос\/заметка/);
  assert.ok(blank.endsWith('ДАННЫЕ МОНИТОРИНГА:\n\n(контекст пуст)\n'));
  const nulls = buildMonitoringAnalysisPrompt({ analysisType: 'alert', note: null, context: null });
  assert.match(nulls, /^Тип анализа: alert$/m);
  assert.ok(nulls.endsWith('(контекст пуст)\n'));
});

test('промпт: контекст подставляется последним и не разбирается на плейсхолдеры', () => {
  const prompt = buildMonitoringAnalysisPrompt({
    analysisType: 'logs',
    note: null,
    context: 'nginx: GET /{{ANALYSIS_TYPE}} {{NOTE_BLOCK}}',
  });
  assert.ok(prompt.endsWith('nginx: GET /{{ANALYSIS_TYPE}} {{NOTE_BLOCK}}\n'));
  assert.match(prompt, /^Тип анализа: logs$/m);
});

test('успех: ответ уходит в resultMarkdown, стоимость и токены — в complete от имени диспетчера', async () => {
  const { runner, completions, calls } = setup('\n## Вердикт\nСервер деградировал  \n');
  await runner.execute(job({ analysisType: 'logs', note: 'почему 502?' }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.billedUserId, 'user-1');
  assert.equal(calls[0]!.tier, 'default');
  assert.equal(calls[0]!.reasoningEffort, 'medium');
  assert.ok(calls[0]!.timeoutMs > 0 && calls[0]!.timeoutMs < 5 * 60 * 1000);
  assert.ok(calls[0]!.instructions.length > 0);
  assert.equal(
    calls[0]!.input,
    buildMonitoringAnalysisPrompt({ analysisType: 'logs', note: 'почему 502?', context: CONTEXT }),
  );
  assert.deepEqual(completions, [
    {
      userId: 'disp-1',
      jobId: 'job-1',
      ok: true,
      resultMarkdown: '## Вердикт\nСервер деградировал',
      error: null,
      costUsd: 0.0123,
      tokensIn: 5000,
      tokensOut: 700,
    },
  ]);
});

test('длинный ответ обрезается до 300 000 символов, как maxOutputChars воркера', async () => {
  const { runner, completions } = setup('x'.repeat(300_010));
  await runner.execute(job());
  assert.equal(completions[0]!.ok, true);
  assert.equal(completions[0]!.resultMarkdown!.length, 300_000);
});

test('ошибка модели завершает job как failed с причиной и без стоимости', async () => {
  const { runner, completions } = setup(new Error('Достигнут лимит подписки ChatGPT — повторите позже.'));
  await runner.execute(job());
  assert.deepEqual(completions, [
    {
      userId: 'disp-1',
      jobId: 'job-1',
      ok: false,
      resultMarkdown: null,
      error: 'llm_failed: Достигнут лимит подписки ChatGPT — повторите позже.',
    },
  ]);
});

test('пустой ответ — failed; длинная ошибка режется до 500 символов', async () => {
  const empty = setup('  \n ');
  await empty.runner.execute(job());
  assert.equal(empty.completions[0]!.ok, false);
  assert.equal(empty.completions[0]!.error, 'llm_failed: ChatGPT вернул пустой ответ');

  const long = setup(new Error('x'.repeat(1000)));
  await long.runner.execute(job());
  assert.equal(long.completions[0]!.error!.length, 500);
});

// Сквозной путь через настоящий CompleteMonitoringAnalysisJob: проверки диспетчера/статуса
// и метеринг расхода на инициатора — те же, что у POST .../complete.
function realComplete(initial: MonitoringAnalysisJob) {
  const stored = new Map([[initial.id, initial]]);
  const usage: RecordUsageInput[] = [];
  const repo = {
    findById: async (id: string) => stored.get(id) ?? null,
    complete: async (input: Parameters<MonitoringAnalysisJobRepository['complete']>[0]) => {
      const current = stored.get(input.id)!;
      stored.set(input.id, { ...current, ...input, status: input.status });
    },
  } as unknown as MonitoringAnalysisJobRepository;
  const complete = new CompleteMonitoringAnalysisJob({
    monitoringAnalysisJobs: repo,
    recordUsage: { execute: async (input: RecordUsageInput) => void usage.push(input) } as unknown as RecordUsage,
  });
  return { stored, usage, complete };
}

test('через CompleteMonitoringAnalysisJob: job succeeded, расход записан на инициатора', async () => {
  const { stored, usage, complete } = realComplete(job());
  const runner = new RunMonitoringAnalysisJobWithLlm({ complete, llm: { generate: async () => reply('## Вердикт\nОК') } });
  await runner.execute(job());

  const done = stored.get('job-1')!;
  assert.equal(done.status, 'succeeded');
  assert.equal(done.resultMarkdown, '## Вердикт\nОК');
  assert.equal(done.costUsd, 0.0123);
  assert.deepEqual(usage, [
    {
      source: 'monitoring',
      refId: 'job-1',
      dispatcherUserId: 'user-1',
      projectId: 'p1',
      model: null,
      tokensIn: 5000,
      tokensOut: 700,
      costUsd: 0.0123,
    },
  ]);
});

test('job, уже снятый очисткой, не переписывается: сбой завершения уходит раннеру', async () => {
  const { stored, complete } = realComplete(job({ status: 'cancelled', error: 'dispatcher_timeout' }));
  const runner = new RunMonitoringAnalysisJobWithLlm({ complete, llm: { generate: async () => reply('## Вердикт\nОК') } });
  await assert.rejects(runner.execute(job()), MonitoringAnalysisJobNotInRunningStateError);
  assert.equal(stored.get('job-1')!.status, 'cancelled');
  assert.equal(stored.get('job-1')!.error, 'dispatcher_timeout');
});
