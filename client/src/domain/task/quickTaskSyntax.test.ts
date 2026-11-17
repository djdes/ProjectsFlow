import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuickTask, stripQuickTaskTokens } from './quickTaskSyntax';

// Вторник, 17 ноября 2026.
const today = new Date(2026, 10, 17);
const candidates = {
  members: [
    { id: 'u-denis', label: 'Денис Волков' },
    { id: 'u-benzin', label: 'benzin' },
    { id: 'u-oleg', label: 'Олег Боев' },
    { id: 'u-olga', label: 'Ольга Ким' },
  ],
  projects: [
    { id: 'p-site', name: 'Сайт клиники' },
    { id: 'p-shop', name: 'Интернет-магазин' },
    { id: 'p-site2', name: 'Сайт-визитка' },
  ],
};

test('one line carries deadline, assignee, priority and project; the title keeps only the words', () => {
  const r = parseQuickTask('завтра @Денис сверстать лендинг !высокий #клиники', today, candidates);
  assert.equal(r.deadline, '2026-11-18');
  assert.deepEqual(r.assignee, { id: 'u-denis', label: 'Денис Волков' });
  assert.equal(r.priority, 2);
  assert.deepEqual(r.project, { id: 'p-site', name: 'Сайт клиники' });
  assert.equal(r.title, 'сверстать лендинг');
});

test('dates: послезавтра, через N дней, weekday (always ahead), DD.MM rolling to next year', () => {
  assert.equal(parseQuickTask('отчёт послезавтра', today, candidates).deadline, '2026-11-19');
  assert.equal(parseQuickTask('через 3 дня созвон', today, candidates).deadline, '2026-11-20');
  assert.equal(parseQuickTask('через неделю релиз', today, candidates).deadline, '2026-11-24');
  assert.equal(parseQuickTask('созвон в пятницу', today, candidates).deadline, '2026-11-20');
  assert.equal(parseQuickTask('планёрка во вторник', today, candidates).deadline, '2026-11-24');
  assert.equal(parseQuickTask('сдать до пт', today, candidates).deadline, '2026-11-20');
  assert.equal(parseQuickTask('оплата 05.12', today, candidates).deadline, '2026-12-05');
  assert.equal(parseQuickTask('продлить 10.01', today, candidates).deadline, '2027-01-10');
  assert.equal(parseQuickTask('сдать 31.02', today, candidates).deadline, null);
  assert.equal(parseQuickTask('во вторник сдать', today, candidates).title, 'сдать');
});

test('ambiguous or unknown names are left in the text', () => {
  const r = parseQuickTask('позвонить @Ол и #Сайт', today, candidates);
  assert.equal(r.assignee, null, '@Ол matches Олег and Ольга');
  assert.equal(r.project, null, '#Сайт matches two projects');
  assert.equal(r.title, 'позвонить @Ол и #Сайт');
  assert.equal(parseQuickTask('написать @кому-то', today, candidates).assignee, null);
});

test('words inside other words are not tokens; only the first line is parsed', () => {
  const r = parseQuickTask('завтрак для команды\nзавтра @Денис', today, candidates);
  assert.equal(r.deadline, null);
  assert.equal(r.assignee, null);
  assert.equal(parseQuickTask('email a@b.ru', today, candidates).assignee, null);
});

test('a word after a hyphen in a project name matches: #магазин → «Интернет-магазин»', () => {
  assert.deepEqual(parseQuickTask('обновить прайс #магазин', today, candidates).project, { id: 'p-shop', name: 'Интернет-магазин' });
});

test('priority by number and word', () => {
  assert.equal(parseQuickTask('упал сайт !1', today, candidates).priority, 1);
  assert.equal(parseQuickTask('упал сайт !срочно', today, candidates).priority, 1);
  assert.equal(parseQuickTask('почистить !низкий', today, candidates).priority, 4);
});

test('stripping keeps the body and skips tokens the user turned off', () => {
  const text = 'завтра @benzin обновить прайс !2\nДетали в чате';
  const r = parseQuickTask(text, today, candidates);
  assert.equal(stripQuickTaskTokens(text, r), 'обновить прайс\nДетали в чате');
  assert.equal(stripQuickTaskTokens(text, r, new Set(['assignee'])), '@benzin обновить прайс\nДетали в чате');
});
