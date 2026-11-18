import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickIncidentProject,
  readIncidentOrigin,
  signIncidentRequest,
  stripIntakeOrigin,
} from './incidentIntake.js';

const KEY = 'incident-signing-key-not-a-secret-1234567';
const source = { chatId: -100500, userId: 7, messageId: 42, messageThreadId: 3, senderName: 'DJ' };

test('signed incident origin round-trips and is stripped from visible text', () => {
  const text = signIncidentRequest('Не работает отчёт', source, 'p1', KEY);
  const origin = readIncidentOrigin(text, KEY);
  assert.equal(origin?.chatId, -100500);
  assert.equal(origin?.messageId, 42);
  assert.equal(origin?.projectId, 'p1');
  assert.equal(stripIntakeOrigin(text), 'Не работает отчёт');
});

test('wrong key or tampered payload is rejected', () => {
  const text = signIncidentRequest('Сбой', source, 'p1', KEY);
  assert.equal(readIncidentOrigin(text, `${KEY}x`), null);
  assert.equal(readIncidentOrigin(text.replace('tg-incident-origin:e', 'tg-incident-origin:f'), KEY), null);
  assert.equal(readIncidentOrigin(text, null), null);
});

test('legacy csharp-fixer-origin marker is still stripped', () => {
  assert.equal(stripIntakeOrigin(`Ошибка\n\n<!-- csharp-fixer-origin:abc:${'a'.repeat(64)} -->`), 'Ошибка');
});

test('project pick: single project, name/stem match, ambiguity', () => {
  const projects = [{ id: 'a', name: 'Планер' }, { id: 'b', name: 'Конфигуратор' }];
  assert.equal(pickIncidentProject('что угодно', [projects[0]!]), 'a');
  assert.equal(pickIncidentProject('в конфигураторе пропала кнопка', projects), 'b');
  assert.equal(pickIncidentProject('в планере ошибка', projects), 'a');
  assert.equal(pickIncidentProject('всё сломалось', projects), null);
  assert.equal(pickIncidentProject('планер и конфигуратор', projects), null);
});
