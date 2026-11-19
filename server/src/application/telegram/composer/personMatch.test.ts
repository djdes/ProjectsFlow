import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineTextMentions, matchPerson, skeleton, telegramIdOfMention } from './personMatch.js';

const PEOPLE = [
  { id: 'u1', displayName: 'Василий Петров', email: 'v.petrov@mail.ru' },
  { id: 'u2', displayName: 'Олег', email: 'oleg@x.ru' },
  { id: 'u3', displayName: 'Анна Смирнова', email: null },
  { id: 'u4', displayName: 'Пётр Иванов', email: 'boss@x.ru' },
  { id: 'u5', displayName: 'Константин', email: null },
  { id: 'u6', displayName: 'Ирина', email: null },
  { id: 'u7', displayName: 'Сергей Алексеев', email: null },
  { id: 'u8', displayName: 'Юлия', email: null },
];

function who(query: string): string | null {
  return matchPerson(query, PEOPLE).unique?.id ?? null;
}

test('skeleton: кириллица и латиница, ё/е, варианты записи сводятся к одному', () => {
  assert.equal(skeleton('Пётр'), skeleton('Petr'));
  assert.equal(skeleton('Юлия'), skeleton('Yuliya'));
  assert.equal(skeleton('Алексей'), skeleton('Alexey'));
  assert.equal(skeleton('Олег'), skeleton('oleg'));
});

test('matchPerson: падежи имени и фамилии', () => {
  for (const q of ['Олегу', 'Олегом', 'Олега']) assert.equal(who(q), 'u2', q);
  for (const q of ['Константину', 'Ириной', 'Сергею', 'Иванову', 'Петровым', 'Смирновой']) assert.ok(who(q), q);
  assert.equal(who('Константину'), 'u5');
  assert.equal(who('Петровым'), 'u1');
});

test('matchPerson: уменьшительные формы, в том числе в падеже', () => {
  assert.equal(who('Вася'), 'u1');
  assert.equal(who('Васе'), 'u1');
  assert.equal(who('Пете'), 'u4');
  assert.equal(who('Аня'), 'u3');
  assert.equal(who('Ане'), 'u3');
  assert.equal(who('Ире'), 'u6');
  assert.equal(who('Серёже'), 'u7');
  assert.equal(who('Юле'), 'u8');
});

test('matchPerson: латиница, ник с подчёркиванием и почта', () => {
  assert.equal(who('oleg'), 'u2');
  assert.equal(who('vasya'), 'u1');
  assert.equal(who('ivanov'), 'u4');
  assert.equal(who('v.petrov'), 'u1');
  assert.equal(who('boss'), 'u4');
  assert.equal(who('anna_smirnova'), 'u3');
});

test('matchPerson: точное совпадение сильнее приблизительного; неоднозначность — без выбора', () => {
  const people = [
    { id: 'a', displayName: 'Иван Сидоров' },
    { id: 'b', displayName: 'Пётр Иванов' },
  ];
  assert.equal(matchPerson('Иван', people).unique?.id, 'a');
  const two = matchPerson('Ва', [{ id: 'a', displayName: 'Василий' }, { id: 'b', displayName: 'Вадим' }]);
  assert.equal(two.unique, null);
  assert.equal(two.matches.length, 2);
  assert.equal(matchPerson('zzz', PEOPLE).matches.length, 0);
});

test('text_mention: привязанный человек → @tgid, остальные → @Имя', async () => {
  const text = 'Сделать отчёт Иван Петров и Маша';
  const out = await inlineTextMentions(
    text,
    [
      { type: 'text_mention', offset: 14, length: 11, user: { id: 42, first_name: 'Иван' } },
      { type: 'text_mention', offset: 28, length: 4, user: { id: 7, first_name: 'Маша' } },
      { type: 'bold', offset: 0, length: 7 },
    ],
    async (id) => id === 42,
  );
  assert.equal(out, 'Сделать отчёт @tgid:42 и @Маша');
  assert.equal(telegramIdOfMention('tgid:42'), 42);
  assert.equal(telegramIdOfMention('Маша'), null);
});
