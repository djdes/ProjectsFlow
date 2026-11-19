import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coAssigneeAiText,
  coAssigneesOf,
  extractAssigneeQueries,
  fanOutCoAssignees,
  withCoAssigneeNote,
} from './coAssignees.js';
import type { TelegramDraftSegment } from '../TelegramTaskDraftRepository.js';

const VASYA = { userId: 'u2', displayName: 'Вася' };
const PETYA = { userId: 'u3', displayName: 'Петя' };

function seg(over: Partial<TelegramDraftSegment> = {}): TelegramDraftSegment {
  return {
    title: 'Отчёт',
    body: 'Собрать отчёт за месяц',
    projectId: 'p1',
    projectName: 'Альфа',
    assigneeUserId: null,
    assigneeName: 'Вася',
    deadline: '2026-11-20',
    included: true,
    targetStatus: null,
    ...over,
  };
}

test('extractAssigneeQueries: все @ по порядку, без повторов и хвостовой пунктуации', () => {
  assert.deepEqual(extractAssigneeQueries('@Вася, @петя сделать отчёт @ВАСЯ @'), ['Вася', 'петя']);
  assert.deepEqual(extractAssigneeQueries('+Альфа отчёт @вася'), ['вася']);
  assert.deepEqual(extractAssigneeQueries('просто текст'), []);
});

test('coAssigneeAiText: модель просят не делить задачу по людям и называют всех', () => {
  const text = coAssigneeAiText('Собрать отчёт', [VASYA, PETYA]);
  assert.match(text, /^Собрать отчёт\n\n/);
  assert.match(text, /Ответственные исполнители .*: Вася, Петя$/);
});

test('fanOutCoAssignees: копия каждому, в описании — все исполнители', () => {
  const { segments, origin } = fanOutCoAssignees([seg(), seg({ title: 'Второе', body: 'Ещё' })], [VASYA, PETYA]);
  assert.equal(segments.length, 4);
  assert.deepEqual(origin, [0, 0, 1, 1]);
  assert.deepEqual(segments.map((s) => s.assigneeUserId), ['u2', 'u3', 'u2', 'u3']);
  assert.ok(segments.every((s) => s.assigneeName === null));
  assert.ok(segments.every((s) => s.coAssignees?.length === 2));
  assert.match(segments[0]!.body, /^Собрать отчёт за месяц\n\n👥 \*\*Ответственные исполнители:\*\* Вася, Петя/);
  assert.equal(segments[0]!.title, 'Отчёт');
  assert.equal(segments[1]!.projectId, 'p1');
});

test('fanOutCoAssignees: дополнение существующей задачи не размножается', () => {
  const { segments, origin } = fanOutCoAssignees([seg({ existingTaskId: 't9' })], [VASYA, PETYA]);
  assert.equal(segments.length, 1);
  assert.deepEqual(origin, [0]);
  assert.equal(segments[0]!.existingTaskId, 't9');
});

test('withCoAssigneeNote: повтор не дублирует строку исполнителей', () => {
  const once = withCoAssigneeNote('Текст', [VASYA, PETYA]);
  const twice = withCoAssigneeNote(once, [VASYA, PETYA]);
  assert.equal(twice, once);
  assert.equal(twice.split('Ответственные исполнители').length, 2);
});

test('coAssigneesOf: читает список из сегментов, обычный черновик — пусто', () => {
  assert.deepEqual(coAssigneesOf(null), []);
  assert.deepEqual(coAssigneesOf([seg()]), []);
  const { segments } = fanOutCoAssignees([seg()], [VASYA, PETYA]);
  assert.deepEqual(coAssigneesOf(segments), [VASYA, PETYA]);
});
