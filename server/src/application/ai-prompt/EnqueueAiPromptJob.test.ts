import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnqueueAiPromptJob } from './EnqueueAiPromptJob.js';
import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';

// --- Минимальные in-memory фейки (тест гоняется через tsx + node:test, без новых deps) ---
// Покрываем НОВОЕ поведение compose-advanced (ленивый pass-2) на inbox-пути (projectId=null):
//  - попадает в строгий compose-bucket (как pass-1), НЕ в общий improve-bucket;
//  - НЕ собирает контекст кандидатов (prepareComposeContext → members.listProjectsForUser не зовётся);
//  - kbContext=null, mode и inputText (JSON сегментов) доходят до create() как есть.

type HitCall = { bucket: string; perHour: number };

function makeDeps(defaultDispatcher: string | null = 'disp-1') {
  const hits: HitCall[] = [];
  const created: Array<{
    mode: string;
    inputText: string;
    kbContext: string | null;
    dispatcherUserId: string;
    projectId: string | null;
  }> = [];

  const partial = {
    // На inbox-пути compose-advanced/improve эти репозитории не должны трогаться.
    projects: {},
    members: {
      listProjectsForUser: async () => {
        throw new Error('listProjectsForUser must NOT be called on inbox compose-advanced/improve');
      },
    },
    listKbDocuments: {},
    getKbDocument: {},
    aiPromptJobs: {
      create: async (input: {
        createdBy: string;
        projectId: string | null;
        dispatcherUserId: string;
        mode: string;
        inputText: string;
        kbContext: string | null;
      }): Promise<AiPromptJob> => {
        created.push({
          mode: input.mode,
          inputText: input.inputText,
          kbContext: input.kbContext,
          dispatcherUserId: input.dispatcherUserId,
          projectId: input.projectId,
        });
        return {
          id: 'job-1',
          createdBy: input.createdBy,
          projectId: input.projectId,
          dispatcherUserId: input.dispatcherUserId,
          status: 'queued',
          mode: input.mode as AiPromptJob['mode'],
          inputText: input.inputText,
          kbContext: input.kbContext,
          improvedText: null,
          error: null,
          claimedAt: null,
          finishedAt: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        };
      },
    },
    rateLimiter: {
      hit: (bucket: string, perHour: number): boolean => {
        hits.push({ bucket, perHour });
        return true;
      },
    },
    resolveDefaultDispatcherUserId: async () => defaultDispatcher,
  };

  const deps = partial as unknown as ConstructorParameters<typeof EnqueueAiPromptJob>[0];
  return { deps, hits, created };
}

test('compose-advanced (inbox): строгий compose-bucket, kbContext=null, без сбора контекста кандидатов', async () => {
  const { deps, hits, created } = makeDeps();
  const payload = '{"segments":[{"id":"s1","title":"T","simpleBody":"B","projectId":null}]}';
  const job = await new EnqueueAiPromptJob(deps).execute({
    userId: 'u1',
    text: payload,
    projectId: null,
    mode: 'compose-advanced',
  });

  assert.equal(job.mode, 'compose-advanced');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.kbContext, null); // полную KB воркер берёт сам через /kb-bundle
  assert.equal(created[0]?.dispatcherUserId, 'disp-1');
  assert.equal(created[0]?.inputText, payload); // JSON сегментов проходит как есть
  // Один rate-hit, и именно в строгий compose-бакет (30/час), не в improve (60/час).
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.bucket, 'ai-compose:u1');
  assert.equal(hits[0]?.perHour, 30);
});

test('improve (inbox): отдельный, более мягкий rate-bucket (регрессия)', async () => {
  const { deps, hits } = makeDeps();
  await new EnqueueAiPromptJob(deps).execute({
    userId: 'u1',
    text: 'почини логин',
    projectId: null,
    mode: 'improve',
  });
  assert.equal(hits[0]?.bucket, 'ai-prompt:u1');
  assert.equal(hits[0]?.perHour, 60);
});

// --- assistant (очередь ИИ-ассистентов продуктов: DocsFlow/ScanFlow) ---
// Проверяем: свой щедрый bucket, KB не собирается, а у проекта БЕЗ диспетчера происходит
// fallback на дефолтного (иначе очередь продукта встала бы с 503).

function makeProjectDeps(opts: {
  dispatcherUserId: string | null;
  defaultDispatcher?: string | null;
}) {
  const base = makeDeps(opts.defaultDispatcher ?? 'disp-default');
  const partial = base.deps as unknown as Record<string, unknown>;
  partial['projects'] = {
    getById: async () => ({
      id: 'p1',
      name: 'DocsFlow',
      dispatcherUserId: opts.dispatcherUserId,
      workspaceId: 'w1',
    }),
  };
  partial['members'] = {
    findForProject: async () => ({
      projectId: 'p1',
      userId: 'u1',
      role: 'owner',
      joinedAt: new Date(0),
    }),
  };
  // KB не должен собираться для assistant.
  partial['listKbDocuments'] = {
    execute: async () => {
      throw new Error('listKbDocuments must NOT be called for assistant mode');
    },
  };
  return base;
}

test('assistant: свой щедрый bucket, kbContext=null, KB не собирается', async () => {
  const { deps, hits, created } = makeProjectDeps({ dispatcherUserId: 'disp-docsflow' });
  const payload = '---\ntype: docsflow_assistant\n---\nШаг 1...';
  const job = await new EnqueueAiPromptJob(deps).execute({
    userId: 'u1',
    text: payload,
    projectId: 'p1',
    mode: 'assistant',
  });

  assert.equal(job.mode, 'assistant');
  assert.equal(created[0]?.kbContext, null);
  assert.equal(created[0]?.inputText, payload);
  assert.equal(created[0]?.dispatcherUserId, 'disp-docsflow');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.bucket, 'ai-assistant:u1');
  assert.equal(hits[0]?.perHour, 300);
});

test('assistant: у проекта нет диспетчера — fallback на дефолтного, не 503', async () => {
  const { deps, created } = makeProjectDeps({
    dispatcherUserId: null,
    defaultDispatcher: 'disp-default',
  });
  await new EnqueueAiPromptJob(deps).execute({
    userId: 'u1',
    text: 'инструкция',
    projectId: 'p1',
    mode: 'assistant',
  });
  assert.equal(created[0]?.dispatcherUserId, 'disp-default');
});

test('improve: у проекта нет диспетчера — по-прежнему ошибка (регрессия)', async () => {
  const { deps } = makeProjectDeps({ dispatcherUserId: null, defaultDispatcher: 'disp-default' });
  await assert.rejects(
    () =>
      new EnqueueAiPromptJob(deps).execute({
        userId: 'u1',
        text: 'почини логин',
        projectId: 'p1',
        mode: 'improve',
      }),
    /dispatcher/i,
  );
});

test('compose-advanced: при срабатывании лимита — AiPromptRateLimitedError', async () => {
  const { deps } = makeDeps();
  (deps.rateLimiter as unknown as { hit: () => boolean }).hit = () => false;
  await assert.rejects(
    () =>
      new EnqueueAiPromptJob(deps).execute({
        userId: 'u1',
        text: '{"segments":[]}',
        projectId: null,
        mode: 'compose-advanced',
      }),
    /лимит/i,
  );
});
