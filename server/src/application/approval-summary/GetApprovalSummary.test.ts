import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetApprovalSummary } from './GetApprovalSummary.js';
import { collectApprovalEvidence } from './collectApprovalEvidence.js';
import { normalizeApprovalSummary, type StoredApprovalSummary } from '../../domain/approval-summary/ApprovalSummary.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { LlmNotConnectedError, LlmRateLimitedError } from '../../domain/llm/errors.js';
import type { LiveEvent } from '../../domain/live/LiveEvent.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { GenerateLlmTextInput, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';

const NOW = new Date('2026-11-17T09:00:00Z');

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 's1',
    projectId: 'p1',
    taskId: 't1',
    agentName: 'ralph-worker',
    attempt: 1,
    status: 'completed',
    model: null,
    billedUserId: 'lead',
    headBefore: null,
    headAfter: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    baseSeq: 1,
    lastSeq: 4,
    eventCount: 4,
    startedAt: new Date('2026-11-16T10:00:00Z'),
    endedAt: new Date('2026-11-16T10:20:00Z'),
    ...overrides,
  };
}

function event(seq: number, kind: string, text: string | null, payload: unknown = null): LiveEvent {
  return { seq, kind, text, payload, createdAt: new Date('2026-11-16T10:10:00Z') };
}

function comment(id: string, ownerUserId: string, body: string, actorKind: TaskComment['actorKind'] = 'user'): TaskComment {
  return {
    id,
    taskId: 't1',
    ownerUserId,
    body,
    actorKind,
    agentName: actorKind === 'agent' ? 'ralph-worker' : null,
    notifyMode: 'all',
    replyToCommentId: null,
    quotedText: null,
    createdAt: new Date('2026-11-16T11:00:00Z'),
    updatedAt: new Date('2026-11-16T11:00:00Z'),
  };
}

function commit(sha: string, message: string): TaskCommit {
  return {
    taskId: 't1',
    sha,
    message,
    authorName: 'Борис',
    authorAvatarUrl: null,
    htmlUrl: `https://github.com/acme/site/commit/${sha}`,
    committedAt: new Date('2026-11-16T10:15:00Z'),
    linkedAt: new Date('2026-11-16T10:16:00Z'),
  };
}

type Reply = string | Error | Promise<string>;

function harness(options: { status?: string; llm?: 'none' } = {}) {
  const task = {
    id: 't1',
    projectId: 'p1',
    description: 'Сверстать страницу врачей\nКарточки с фильтром по специальности.',
    status: options.status ?? 'pending_approval',
    assignee: { userId: 'worker', displayName: 'Борис', avatarUrl: null },
    createdBy: 'lead',
  };
  const state = {
    sessions: [session()] as LiveSession[],
    events: [
      event(1, 'tool_use', null, { name: 'read', brief: 'src/doctors.tsx' }),
      event(2, 'assistant_text', 'Сделал страницу врачей с фильтром по специальности.'),
      event(3, 'check_result', null, { name: 'build', exitCode: 0 }),
      event(4, 'diff_summary', null, { files: [{ path: 'src/doctors.tsx', change: 'added', additions: 120, deletions: 0 }] }),
    ] as LiveEvent[],
    commits: [] as TaskCommit[],
    comments: [] as TaskComment[],
  };
  const stored = new Map<string, StoredApprovalSummary>();
  const saves: StoredApprovalSummary[] = [];
  const calls: GenerateLlmTextInput[] = [];
  const logs: string[] = [];
  let reply: Reply = '## Итог\n- Страница врачей добавлена, есть фильтр по специальности.\n- **Сборка** прошла.';
  const useCase = new GetApprovalSummary({
    projects: { getById: async (id: string) => (id === 'p1' ? { id: 'p1', isInbox: false, ownerId: 'lead' } : null) } as never,
    members: {
      findForProject: async (_projectId: string, userId: string) =>
        ['lead', 'worker'].includes(userId) ? { projectId: 'p1', userId, role: 'viewer', joinedAt: NOW } : null,
    } as never,
    tasks: { getById: async (id: string) => (id === 't1' ? task : null) } as never,
    live: {
      listSessions: async () => state.sessions,
      listEvents: async (_sessionId: string, afterSeq: number, limit: number) =>
        state.events.filter((e) => e.seq > afterSeq).slice(0, limit),
    },
    taskCommits: { listByTask: async () => state.commits },
    comments: { listByTask: async () => state.comments },
    summaries: {
      find: async (taskId) => stored.get(taskId) ?? null,
      save: async (summary) => {
        saves.push(summary);
        stored.set(summary.taskId, summary);
      },
    },
    llm:
      options.llm === 'none'
        ? null
        : {
            async generate(input): Promise<GenerateLlmTextResult> {
              calls.push(input);
              const current = await reply;
              if (current instanceof Error) throw current;
              return { text: current, model: 'test-model', usage: null, costUsd: null };
            },
          },
    now: () => NOW,
    log: (message) => logs.push(message),
  });
  return {
    useCase,
    task,
    state,
    stored,
    saves,
    calls,
    logs,
    setReply: (next: Reply) => {
      reply = next;
    },
  };
}

test('summary is generated once, cleaned of markdown and then served from the cache', async () => {
  const h = harness();
  const first = await h.useCase.execute('p1', 'lead', 't1');
  assert.equal(first.summary, 'Страница врачей добавлена, есть фильтр по специальности.\nСборка прошла.');
  assert.deepEqual(first.generatedAt, NOW);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]!.billedUserId, 'lead');
  assert.equal(h.calls[0]!.tier, 'fast');
  assert.match(h.calls[0]!.input, /Сверстать страницу врачей/);
  assert.match(h.calls[0]!.input, /Сделал страницу врачей с фильтром/);
  assert.match(h.calls[0]!.input, /build — прошла/);
  assert.match(h.calls[0]!.input, /добавлен src\/doctors\.tsx \(\+120 −0\)/);
  assert.equal(h.saves.length, 1);
  assert.match(h.saves[0]!.inputHash, /^[0-9a-f]{64}$/);

  h.setReply('другая сводка');
  const second = await h.useCase.execute('p1', 'worker', 't1');
  assert.equal(second.summary, first.summary);
  assert.equal(h.calls.length, 1, 'повтор с тем же входом не должен звать модель');
});

test('a new commit, comment or worker run invalidates the cached summary', async () => {
  const h = harness();
  await h.useCase.execute('p1', 'lead', 't1');
  const firstHash = h.saves[0]!.inputHash;

  h.state.commits.push(commit('abc1234def', 'feat: фильтр врачей по специальности\n\nподробности'));
  h.setReply('Добавлен фильтр врачей, коммит abc1234.');
  const afterCommit = await h.useCase.execute('p1', 'lead', 't1');
  assert.equal(afterCommit.summary, 'Добавлен фильтр врачей, коммит abc1234.');
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1]!.input, /abc1234 2026-11-16 Борис: feat: фильтр врачей по специальности/);
  assert.notEqual(h.saves[1]!.inputHash, firstHash);

  // Комментарий руководителя — не данные о работе исполнителя: вход не меняется.
  h.state.comments.push(comment('c-lead', 'lead', 'Проверю вечером'));
  await h.useCase.execute('p1', 'lead', 't1');
  assert.equal(h.calls.length, 2);

  h.state.comments.push(comment('c-worker', 'worker', 'Готово, проверил на телефоне'));
  await h.useCase.execute('p1', 'lead', 't1');
  assert.equal(h.calls.length, 3);
  assert.match(h.calls[2]!.input, /Исполнитель \(2026-11-16\): Готово, проверил на телефоне/);
  assert.doesNotMatch(h.calls[2]!.input, /Проверю вечером/);

  h.state.sessions = [session({ id: 's2', startedAt: new Date('2026-11-16T12:00:00Z') }), ...h.state.sessions];
  h.state.events = [event(1, 'assistant_text', 'Поправил отступы карточек.')];
  await h.useCase.execute('p1', 'lead', 't1');
  assert.equal(h.calls.length, 4);
  assert.match(h.calls[3]!.input, /Поправил отступы карточек/);
});

test('concurrent requests for the same task share one model call', async () => {
  const h = harness();
  let release!: (text: string) => void;
  h.setReply(new Promise<string>((resolve) => (release = resolve)));
  const a = h.useCase.execute('p1', 'lead', 't1');
  const b = h.useCase.execute('p1', 'worker', 't1');
  const c = h.useCase.execute('p1', 'lead', 't1');
  await new Promise((resolve) => setImmediate(resolve));
  release('Страница врачей готова.');
  const results = await Promise.all([a, b, c]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(results.map((r) => r.summary), ['Страница врачей готова.', 'Страница врачей готова.', 'Страница врачей готова.']);
  assert.equal(h.saves.length, 1);

  // После завершения следующий запрос берёт сводку из кэша, а не стартует новый вызов.
  await h.useCase.execute('p1', 'lead', 't1');
  assert.equal(h.calls.length, 1);
});

test('unavailable subscription gives null without caching, and the next request retries', async () => {
  for (const error of [new LlmNotConnectedError(), new LlmRateLimitedError(null)]) {
    const h = harness();
    h.setReply(error);
    const result = await h.useCase.execute('p1', 'lead', 't1');
    assert.deepEqual(result, { summary: null, generatedAt: null });
    assert.equal(h.saves.length, 0);
    assert.deepEqual(h.logs, [], 'штатная недоступность подписки — не ошибка в логе');

    h.setReply('Страница врачей готова.');
    assert.equal((await h.useCase.execute('p1', 'lead', 't1')).summary, 'Страница врачей готова.');
    assert.equal(h.calls.length, 2);
  }
});

test('other model failures and a missing generator also give null instead of an error', async () => {
  const failing = harness();
  failing.setReply(new Error('upstream 502'));
  assert.deepEqual(await failing.useCase.execute('p1', 'lead', 't1'), { summary: null, generatedAt: null });
  assert.equal(failing.logs.length, 1);
  assert.match(failing.logs[0]!, /upstream 502/);

  const empty = harness();
  empty.setReply('   \n## Итог\n');
  assert.deepEqual(await empty.useCase.execute('p1', 'lead', 't1'), { summary: null, generatedAt: null });
  assert.equal(empty.saves.length, 0);

  const none = harness({ llm: 'none' });
  assert.deepEqual(await none.useCase.execute('p1', 'lead', 't1'), { summary: null, generatedAt: null });
});

test('a cached summary is still served while the subscription is unavailable if the input is unchanged', async () => {
  const h = harness();
  await h.useCase.execute('p1', 'lead', 't1');
  h.setReply(new LlmNotConnectedError());
  const result = await h.useCase.execute('p1', 'lead', 't1');
  assert.ok(result.summary);
  assert.equal(h.calls.length, 1);
});

test('task outside the approval queue or without any evidence gets no summary and no model call', async () => {
  const done = harness({ status: 'done' });
  assert.deepEqual(await done.useCase.execute('p1', 'lead', 't1'), { summary: null, generatedAt: null });
  assert.equal(done.calls.length, 0);

  const bare = harness();
  bare.state.sessions = [];
  assert.deepEqual(await bare.useCase.execute('p1', 'lead', 't1'), { summary: null, generatedAt: null });
  assert.equal(bare.calls.length, 0);

  // Запуск без содержательных событий (одни вызовы инструментов) — тоже не данные.
  const toolsOnly = harness();
  toolsOnly.state.events = [event(1, 'tool_use', null, { name: 'read' })];
  assert.deepEqual(await toolsOnly.useCase.execute('p1', 'lead', 't1'), { summary: null, generatedAt: null });
  assert.equal(toolsOnly.calls.length, 0);
});

test('access is the same as reading the task: outsiders and foreign project ids get 404', async () => {
  const h = harness();
  await assert.rejects(() => h.useCase.execute('p1', 'stranger', 't1'), ProjectNotFoundError);
  await assert.rejects(() => h.useCase.execute('p-other', 'lead', 't1'), ProjectNotFoundError);
  assert.equal(h.calls.length, 0);
});

test('normalizeApprovalSummary keeps at most three plain lines', () => {
  assert.equal(
    normalizeApprovalSummary('Сводка:\n\n# Что сделано\n1. Добавлен фильтр\n* `Сборка` прошла\n> Тесты зелёные\n— Лишняя четвёртая'),
    'Добавлен фильтр\nСборка прошла\nТесты зелёные',
  );
  assert.equal(normalizeApprovalSummary(' \n\n'), null);
  assert.equal(normalizeApprovalSummary('x'.repeat(400))!.length, 220);
});

test('evidence takes the last worker messages, checks, review, files and diff lines', () => {
  const evidence = collectApprovalEvidence({
    task: { description: '<!-- ralph-meta -->Починить скидку\nТекст', assignee: { userId: 'worker', displayName: 'Борис', avatarUrl: null } },
    session: session({ status: 'failed' }),
    events: [
      event(1, 'assistant_text', 'Первое сообщение'),
      event(2, 'assistant_text', 'Второе'),
      event(3, 'assistant_text', 'Третье'),
      event(4, 'assistant_text', 'Четвёртое\n\nс переносом'),
      event(5, 'check_result', null, { name: 'tests', exitCode: 0 }),
      event(6, 'check_result', null, { name: 'tests', exitCode: 1 }),
      event(7, 'review_verdict', null, { approved: false, summary: 'Дублируется расчёт' }),
      event(8, 'file_diff', null, {
        path: 'src/a.ts',
        change: 'modified',
        additions: 1,
        deletions: 1,
        unifiedDiff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;',
        isBinary: false,
      }),
    ],
    commits: [],
    comments: [comment('c1', 'ralph', '<!-- ralph-result -->Отчёт воркера', 'agent')],
  });
  assert.equal(evidence.hasEvidence, true);
  assert.equal(evidence.taskText, 'Починить скидку\nТекст');
  assert.doesNotMatch(evidence.evidence, /Первое сообщение/);
  assert.match(evidence.evidence, /Последний запуск воркера \(завершился ошибкой\)/);
  assert.match(evidence.evidence, /- Четвёртое с переносом/);
  assert.match(evidence.evidence, /Проверки: tests — не прошла \(код 1\)/);
  assert.match(evidence.evidence, /Ревью: есть замечания — Дублируется расчёт/);
  assert.match(evidence.evidence, /изменён src\/a\.ts \(\+1 −1\)/);
  assert.match(evidence.evidence, /src\/a\.ts:\n-const a = 1;\n\+const a = 2;/);
  assert.doesNotMatch(evidence.evidence, /\+\+\+ b/);
  assert.match(evidence.evidence, /Воркер \(2026-11-16\): Отчёт воркера/);
});
