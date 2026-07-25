import assert from 'node:assert/strict';
import test from 'node:test';
import { CommitSyncBatchProgress, parseBatchKeyChatId } from './CommitSyncBatchProgress.js';
import { FlushCommitSyncBatch } from './FlushCommitSyncBatch.js';
import { serializeCommitReviewResult, type CommitReviewResult } from './CommitReviewResult.js';
import type { CommitSyncBatchStatus } from './CommitSyncJobRepository.js';
import type { CommitSyncStatus } from '../../domain/commit-sync/CommitSyncJob.js';

const BATCH = '-100:2026-07-24:17:00';

// --- Фейки ---------------------------------------------------------------

type MutableJob = {
  id: string;
  projectId: string;
  projectName: string;
  batchKey: string | null;
  status: CommitSyncStatus;
  reviewJson: string | null;
  batchFlushedAt: Date | null;
};

// Мини-репозиторий job'ов: покрывает listBatchStatuses (для прогресса) + батч-election (для flush).
class FakeJobRepo {
  readonly jobs = new Map<string, MutableJob>();

  add(job: MutableJob): void {
    this.jobs.set(job.id, job);
  }

  private all(): MutableJob[] {
    return [...this.jobs.values()];
  }

  private pending(j: MutableJob): boolean {
    return j.status === 'queued' || j.status === 'running';
  }

  async listBatchStatuses(batchKey: string): Promise<CommitSyncBatchStatus[]> {
    return this.all()
      .filter((j) => j.batchKey === batchKey)
      .map((j) => ({ projectId: j.projectId, projectName: j.projectName, status: j.status }));
  }

  async findById(id: string): Promise<MutableJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async listByBatchKey(batchKey: string): Promise<MutableJob[]> {
    return this.all().filter((j) => j.batchKey === batchKey);
  }

  async tryMarkBatchFlushed(batchKey: string): Promise<boolean> {
    const batch = this.all().filter((j) => j.batchKey === batchKey);
    if (batch.length === 0) return false;
    if (batch.some((j) => this.pending(j))) return false;
    if (batch.some((j) => j.batchFlushedAt !== null)) return false;
    for (const j of batch) j.batchFlushedAt = new Date();
    return true;
  }

  async tryMarkJobFlushed(): Promise<boolean> {
    return false;
  }

  async findFlushableBatchKeys(): Promise<string[]> {
    const keys = new Set<string>();
    for (const j of this.all()) if (j.batchKey !== null) keys.add(j.batchKey);
    return [...keys].filter((key) => {
      const batch = this.all().filter((j) => j.batchKey === key);
      return !batch.some((j) => this.pending(j)) && !batch.some((j) => j.batchFlushedAt !== null);
    });
  }
}

// Хранилище прогресса: PK по batch_key, tryClaim атомарен (второй вызов → false).
class FakeProgressRepo {
  readonly rows = new Map<string, { chatId: number; messageId: number | null }>();

  async tryClaim(batchKey: string, chatId: number): Promise<boolean> {
    if (this.rows.has(batchKey)) return false;
    this.rows.set(batchKey, { chatId, messageId: null });
    return true;
  }

  async setMessageId(batchKey: string, messageId: number): Promise<void> {
    const row = this.rows.get(batchKey);
    if (row) row.messageId = messageId;
  }

  async get(batchKey: string): Promise<{ chatId: number; messageId: number | null } | null> {
    const row = this.rows.get(batchKey);
    return row ? { ...row } : null;
  }

  async delete(batchKey: string): Promise<void> {
    this.rows.delete(batchKey);
  }
}

type SentMessage = { chatId: number; text: string };
type EditedMessage = { chatId: number; messageId: number; text: string };
type DeletedMessages = { chatId: number; messageIds: readonly number[] };

class FakeTelegram {
  readonly sent: SentMessage[] = [];
  readonly edited: EditedMessage[] = [];
  readonly deleted: DeletedMessages[] = [];
  private nextId = 100;

  async sendMessage(input: { chatId: number; text: string }) {
    this.sent.push({ chatId: input.chatId, text: input.text });
    return { kind: 'ok' as const, messageId: this.nextId++ };
  }

  async editMessageText(input: { chatId: number; messageId: number; text?: string }): Promise<void> {
    this.edited.push({ chatId: input.chatId, messageId: input.messageId, text: input.text ?? '' });
  }

  async deleteMessages(input: DeletedMessages): Promise<void> {
    this.deleted.push(input);
  }
}

function progressHarness() {
  const jobs = new FakeJobRepo();
  const progressRepo = new FakeProgressRepo();
  const telegram = new FakeTelegram();
  const progress = new CommitSyncBatchProgress({
    telegram: telegram as never,
    commitSyncJobs: jobs as never,
    progress: progressRepo as never,
  });
  return { jobs, progressRepo, telegram, progress };
}

function reviewJson(name: string): string {
  const payload: CommitReviewResult = {
    chatId: -100,
    projectName: name,
    mode: 'auto',
    rows: [{ title: `Задача ${name}`, openUrl: 'https://app/open', completeUrl: null }],
  };
  return serializeCommitReviewResult(payload);
}

// --- Тесты ---------------------------------------------------------------

test('(а) старт батча шлёт ОДНО прогресс-сообщение с ⏳ по всем проектам', async () => {
  const h = progressHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  h.jobs.add({ id: 'b', projectId: 'p2', projectName: 'DocsFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });

  await h.progress.start(BATCH);

  assert.equal(h.telegram.sent.length, 1);
  const text = h.telegram.sent[0]!.text;
  assert.match(text, /Сверяю коммиты/);
  assert.match(text, /⏳ OrdersFlow/);
  assert.match(text, /⏳ DocsFlow/);
  // message_id записан — последующие edit/delete найдут сообщение.
  assert.equal(h.progressRepo.rows.get(BATCH)?.messageId, 100);
});

test('(ж) одиночный батч (1 проект) прогресс НЕ шлёт', async () => {
  const h = progressHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });

  await h.progress.start(BATCH);

  assert.equal(h.telegram.sent.length, 0);
  assert.equal(h.progressRepo.rows.has(BATCH), false);
});

test('(д) прогресс шлётся ровно один раз при гонке enqueue (двойной start)', async () => {
  const h = progressHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  h.jobs.add({ id: 'b', projectId: 'p2', projectName: 'DocsFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });

  await Promise.all([h.progress.start(BATCH), h.progress.start(BATCH)]);

  assert.equal(h.telegram.sent.length, 1);
});

test('(б) завершение одного проекта редактирует прогресс: у него ✅, у остальных ⏳', async () => {
  const h = progressHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  h.jobs.add({ id: 'b', projectId: 'p2', projectName: 'DocsFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  await h.progress.start(BATCH);

  // Первый проект готов.
  h.jobs.jobs.get('a')!.status = 'succeeded';
  await h.progress.refresh(BATCH);

  assert.equal(h.telegram.edited.length, 1);
  const text = h.telegram.edited[0]!.text;
  assert.match(text, /✅ OrdersFlow/);
  assert.match(text, /⏳ DocsFlow/);
  assert.equal(h.telegram.edited[0]!.messageId, 100);
});

test('refresh без прогресс-сообщения (единичный/ручной) — no-op', async () => {
  const h = progressHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'succeeded', reviewJson: null, batchFlushedAt: null });
  // start не звали → строки прогресса нет.
  await h.progress.refresh(BATCH);
  assert.equal(h.telegram.edited.length, 0);
});

test('failed-проект в прогрессе показывается как ⚠️', async () => {
  const h = progressHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  h.jobs.add({ id: 'b', projectId: 'p2', projectName: 'DocsFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  await h.progress.start(BATCH);

  h.jobs.jobs.get('a')!.status = 'failed';
  await h.progress.refresh(BATCH);

  assert.match(h.telegram.edited.at(-1)!.text, /⚠️ OrdersFlow/);
});

// --- Финал батча (flush) удаляет прогресс и шлёт/не шлёт итог ------------

function flushHarness() {
  const h = progressHarness();
  const sent: unknown[] = [];
  const conclusions: Array<{ chatId: number; checked: number; failed: number }> = [];
  const flush = new FlushCommitSyncBatch({
    commitSyncJobs: h.jobs as never,
    sendReview: {
      async execute(input: unknown) {
        sent.push(input);
        return true;
      },
      async sendConclusion(input: { chatId: number; checked: number; failed: number }) {
        conclusions.push(input);
        return true;
      },
    } as never,
    progress: h.progress,
    now: () => new Date('2026-07-24T13:00:00Z'),
  });
  return { ...h, flush, sent, conclusions };
}

test('(в) все проекты готовы → прогресс удалён + итог отправлен', async () => {
  const h = flushHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'succeeded', reviewJson: reviewJson('OrdersFlow'), batchFlushedAt: null });
  h.jobs.add({ id: 'b', projectId: 'p2', projectName: 'DocsFlow', batchKey: BATCH, status: 'succeeded', reviewJson: reviewJson('DocsFlow'), batchFlushedAt: null });
  await h.progress.start(BATCH);
  assert.equal(h.telegram.sent.length, 1); // прогресс отправлен

  await h.flush.flushBatch(BATCH);

  // Прогресс-сообщение удалено, строка вычищена, итог отправлен.
  assert.equal(h.telegram.deleted.length, 1);
  assert.deepEqual(h.telegram.deleted[0]!.messageIds, [100]);
  assert.equal(h.progressRepo.rows.has(BATCH), false);
  assert.equal(h.sent.length, 1);
});

test('(г) пустой итог → прогресс удалён, но приходит короткое завершение', async () => {
  const h = flushHarness();
  // Оба проекта без результата (reviewJson=null): один проверен-чист, второй не обработан.
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'succeeded', reviewJson: null, batchFlushedAt: null });
  h.jobs.add({ id: 'b', projectId: 'p2', projectName: 'DocsFlow', batchKey: BATCH, status: 'cancelled', reviewJson: null, batchFlushedAt: null });
  await h.progress.start(BATCH);

  await h.flush.flushBatch(BATCH);

  assert.equal(h.telegram.deleted.length, 1); // прогресс удалён
  assert.equal(h.progressRepo.rows.has(BATCH), false);
  assert.equal(h.sent.length, 0); // дайджеста нет — закрывать нечего
  // Но раз прогресс показывали — закрываем петлю коротким итогом с честным счётчиком.
  assert.equal(h.conclusions.length, 1);
  assert.equal(h.conclusions[0]!.checked, 1);
  assert.equal(h.conclusions[0]!.failed, 1);
});

test('(е) sweep осиротевшего батча удаляет прогресс и шлёт итог', async () => {
  const h = flushHarness();
  h.jobs.add({ id: 'a', projectId: 'p1', projectName: 'OrdersFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  h.jobs.add({ id: 'b', projectId: 'p2', projectName: 'DocsFlow', batchKey: BATCH, status: 'queued', reviewJson: null, batchFlushedAt: null });
  await h.progress.start(BATCH);

  // Один завершился с результатом, второй завис.
  h.jobs.jobs.get('a')!.status = 'succeeded';
  h.jobs.jobs.get('a')!.reviewJson = reviewJson('OrdersFlow');
  // Пока 'b' крутится — sweep молчит, прогресс на месте.
  await h.flush.sweep();
  assert.equal(h.telegram.deleted.length, 0);
  assert.equal(h.sent.length, 0);

  // cleanup добил зависший job (cancelled) → батч терминален.
  h.jobs.jobs.get('b')!.status = 'cancelled';
  const flushed = await h.flush.sweep();

  assert.equal(flushed, 1);
  assert.equal(h.telegram.deleted.length, 1);
  assert.deepEqual(h.telegram.deleted[0]!.messageIds, [100]);
  assert.equal(h.progressRepo.rows.has(BATCH), false);
  assert.equal(h.sent.length, 1); // итог ушёл
});

test('parseBatchKeyChatId извлекает отрицательный chatId группы; битый ключ → null', () => {
  assert.equal(parseBatchKeyChatId('-100:2026-07-24:17:00'), -100);
  assert.equal(parseBatchKeyChatId('42:2026-07-24:09:30'), 42);
  assert.equal(parseBatchKeyChatId('no-colon'), null);
  assert.equal(parseBatchKeyChatId(':2026'), null);
});
