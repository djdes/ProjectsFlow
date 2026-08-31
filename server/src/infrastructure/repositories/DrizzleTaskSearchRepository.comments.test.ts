import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleTaskSearchRepository } from './DrizzleTaskSearchRepository.js';
import { fakeDb } from './fakeDrizzleDb.js';
import type { ProjectMemberRepository } from '../../application/project/ProjectMemberRepository.js';
import type { Database } from '../db/index.js';

// Поиск по комментариям (глобальный поиск, левый верхний угол). Реальной тестовой БД для
// Drizzle-репо в кодбейзе нет (см. fakeDrizzleDb.ts), поэтому проверяем контракт слияния:
// какие строки два select'а (описания → комментарии) превращаются в какие результаты.
// Порядок select'ов детерминирован: Promise.all вычисляет аргументы слева направо.

const adminMembers = {} as unknown as ProjectMemberRepository;

function taskRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: 't1',
    projectId: 'p1',
    projectName: 'Проект',
    status: 'todo',
    description: 'описание задачи',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

test('находит задачу по телу комментария: match=comment + id комментария и отрывок', async () => {
  const db = fakeDb({
    selectRowsSeq: [
      [], // по описанию — ничего
      [taskRow({ commentId: 'c1', commentBody: 'проверь пожалуйста платёжку в понедельник' })],
    ],
  }) as unknown as Database;
  const repo = new DrizzleTaskSearchRepository(db, adminMembers);

  const res = await repo.search({ userId: 'u1', query: 'платёжку', includeAllProjects: true, limit: 20 });
  assert.equal(res.length, 1);
  assert.equal(res[0]!.taskId, 't1');
  assert.equal(res[0]!.match, 'comment');
  assert.equal(res[0]!.commentId, 'c1');
  assert.ok(res[0]!.commentExcerpt!.includes('платёжку'));
});

test('совпадение и в описании, и в комментарии — задача одна, побеждает описание', async () => {
  const db = fakeDb({
    selectRowsSeq: [
      [taskRow({ description: 'платёжка застряла' })],
      [taskRow({ commentId: 'c1', commentBody: 'платёжка ещё не ушла' })],
    ],
  }) as unknown as Database;
  const repo = new DrizzleTaskSearchRepository(db, adminMembers);

  const res = await repo.search({ userId: 'u1', query: 'платёжка', includeAllProjects: true, limit: 20 });
  assert.equal(res.length, 1);
  assert.equal(res[0]!.match, 'description');
  assert.equal(res[0]!.commentId, undefined);
});

test('несколько совпавших комментариев одной задачи схлопываются в одну строку (самый свежий)', async () => {
  const db = fakeDb({
    selectRowsSeq: [
      [],
      [
        taskRow({ commentId: 'c2', commentBody: 'свежий: про отчёт' }),
        taskRow({ commentId: 'c1', commentBody: 'старый: про отчёт' }),
      ],
    ],
  }) as unknown as Database;
  const repo = new DrizzleTaskSearchRepository(db, adminMembers);

  const res = await repo.search({ userId: 'u1', query: 'отчёт', includeAllProjects: true, limit: 20 });
  assert.equal(res.length, 1);
  assert.equal(res[0]!.commentId, 'c2');
});

test('длинный комментарий: отрывок центрируется по совпадению, а не режется с начала', async () => {
  const body = `${'а'.repeat(400)} секретное слово ${'б'.repeat(400)}`;
  const db = fakeDb({
    selectRowsSeq: [[], [taskRow({ commentId: 'c1', commentBody: body })]],
  }) as unknown as Database;
  const repo = new DrizzleTaskSearchRepository(db, adminMembers);

  const res = await repo.search({ userId: 'u1', query: 'секретное', includeAllProjects: true, limit: 20 });
  const excerpt = res[0]!.commentExcerpt!;
  assert.ok(excerpt.includes('секретное'), 'отрывок обязан содержать совпадение — иначе UI нечего подсвечивать');
  assert.ok(excerpt.length < body.length);
});
