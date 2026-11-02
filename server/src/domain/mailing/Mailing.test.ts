import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MailingError, matchesAudience, matchesBase, normalizeMailingEmail, validateMailingContent } from './Mailing.js';
import { previewContactsCsv } from './csv.js';
import { renderMailing } from '../../application/mailing/renderMailing.js';
import { INPUT, NOW, mailingHarness } from '../../../test/mailingHarness.js';

test('CSV imports BOM, semicolons, escaped quotes and multiline companies with normalized deduplication', () => {
  const result = previewContactsCsv('\uFEFFemail;имя;компания\r\nALEX@Example.com;"Алексей ""А""";"Компания\nДва"\r\nalex@example.com;Дубль;Компания\r\nbad;Имя;Компания', 'База');
  assert.equal(result.total, 3); assert.equal(result.duplicates, 1); assert.equal(result.invalid.length, 1);
  assert.deepEqual(result.contacts, [{ email: 'alex@example.com', name: 'Алексей "А"', company: 'Компания\nДва', source: 'База' }]);
});
test('CSV separator is chosen outside quotes and headerless address lists work', () => {
  const result = previewContactsCsv('one@example.com,"Имя; Фамилия",Компания\ntwo@example.com,Два,Компания', 'Источник');
  assert.equal(result.contacts.length, 2); assert.equal(result.contacts[0]!.name, 'Имя; Фамилия');
  assert.equal(previewContactsCsv('one@example.com\ntwo@example.com', 'База').contacts.length, 2);
});
test('CSV refuses unclosed quotes, oversized files, too many contacts and missing source', () => {
  for (const [text, source] of [['"oops', 'База'], ['a'.repeat(500_001), 'База'], [Array(5002).fill('a@example.com').join('\n'), 'База'], ['a@example.com', '']]) {
    assert.throws(() => previewContactsCsv(text!, source!), MailingError);
  }
});
test('audience filters include the entire final Moscow day and respect plan, search and Telegram availability', () => {
  const user = mailingHarness().state.users[0]!;
  assert.equal(matchesAudience({ ...user, createdAt: '2026-10-31T20:59:59Z' }, { registeredTo: '2026-10-31' }), true);
  assert.equal(matchesAudience({ ...user, createdAt: '2026-10-31T21:00:00Z' }, { registeredTo: '2026-10-31' }), false);
  assert.equal(matchesAudience(user, { search: 'АЛЕК', plan: 'free', hasTelegram: true }), true);
  assert.equal(matchesAudience(user, { plan: 'vip' }), false);
  assert.equal(matchesBase(user, 'users:new', NOW), true); assert.equal(matchesBase(user, 'users:paid', NOW), false);
});
test('personalization escapes HTML, header newlines, attribute injection and supports separate HTML/text output', () => {
  const result = renderMailing({ ...INPUT.content, subject: 'Тема\r\nBcc: victim@example.com', body: '{имя}\n\n**Текст** <script>alert(1)</script>', buttonUrl: 'https://example.com/?q="<bad>' }, { name: '<img onerror=alert(1)>', company: 'Команда', email: 'x@example.com' }, { unsubscribe: 'https://projectsflow.ru/u/token' });
  assert.doesNotMatch(result.html, /<script>|<img onerror/); assert.match(result.html, /&lt;img/); assert.match(result.html, /<strong>Текст<\/strong>/);
  assert.doesNotMatch(result.subject, /[\r\n]/); assert.match(result.text, /Отписаться/); assert.match(result.html, /lang="ru"/);
  assert.match(result.html, /&quot;&lt;bad&gt;/);
});
test('launch content rejects unsafe links and missing required text while draft content can remain incomplete', () => {
  for (const buttonUrl of ['javascript:alert(1)', 'data:text/html,bad', 'https://user:pass@example.com/']) assert.throws(() => validateMailingContent({ ...INPUT.content, buttonUrl }), MailingError);
  assert.throws(() => validateMailingContent({ ...INPUT.content, body: ' ' }), MailingError);
  assert.equal(normalizeMailingEmail(' TEST@Example.com '), 'test@example.com');
  assert.equal(normalizeMailingEmail('telegram@account.local'), null);
});
