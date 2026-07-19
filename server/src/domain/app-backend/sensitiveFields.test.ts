import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECRET_MASK,
  classifyField,
  maskValue,
  sensitiveColumns,
  tokenizeFieldName,
} from './sensitiveFields.js';

test('classifyField разбирает имя на токены и не ловит подстроки', () => {
  assert.equal(classifyField('password'), 'secret');
  assert.equal(classifyField('api_key'), 'secret');
  assert.equal(classifyField('apiKey'), 'secret');
  assert.equal(classifyField('stripe-secret'), 'secret');
  assert.equal(classifyField('email'), 'pii');
  assert.equal(classifyField('contactPhone'), 'pii');
  assert.equal(classifyField('keyword'), null);
  assert.equal(classifyField('monkey'), null);
  assert.equal(classifyField('mailing_enabled'), null);
  assert.equal(classifyField('contact_mail'), 'pii');
  assert.equal(classifyField('title'), null);
});

test('classifyField ловит распространённые имена секретов', () => {
  assert.equal(classifyField('jwt'), 'secret');
  assert.equal(classifyField('bearerToken'), 'secret');
  assert.equal(classifyField('auth_header'), 'secret');
  assert.equal(classifyField('refresh'), 'secret');
  assert.equal(classifyField('passphrase'), 'secret');
  assert.equal(classifyField('totp_seed'), 'secret');
  assert.equal(classifyField('recovery_code'), 'secret');
  assert.equal(classifyField('backupCode'), 'secret');
  // `code` без квалификатора остаётся обычной колонкой.
  assert.equal(classifyField('country_code'), null);
  assert.equal(classifyField('promo_code'), null);
  assert.equal(classifyField('author'), null);
});

test('tokenizeFieldName режет snake/kebab/camel', () => {
  assert.deepEqual(tokenizeFieldName('user_api_key'), ['user', 'api', 'key']);
  assert.deepEqual(tokenizeFieldName('userApiKey'), ['user', 'api', 'key']);
  assert.deepEqual(tokenizeFieldName('user-api-key'), ['user', 'api', 'key']);
});

test('maskValue прячет секрет целиком и не раскрывает длину', () => {
  assert.equal(maskValue('hunter2', 'secret'), SECRET_MASK);
  assert.equal(maskValue('very-long-api-token-value', 'secret'), SECRET_MASK);
  assert.equal(maskValue(null, 'secret'), null);
  assert.equal(maskValue('', 'secret'), '');
});

test('maskValue оставляет PII узнаваемым, но не читаемым', () => {
  assert.equal(maskValue('ivan.petrov@mail.ru', 'pii'), 'i••••••••@m•••.ru');
  assert.equal(maskValue('+7 (999) 123-45-67', 'pii'), `${'•'.repeat(7)}4567`);
  const masked = String(maskValue('Москва, Ленина 5', 'pii'));
  assert.equal(masked.startsWith('Мо'), true);
  assert.equal(masked.includes('Ленина'), false);
});

test('sensitiveColumns собирает карту по полям таблицы', () => {
  const map = sensitiveColumns([
    { name: 'title', type: 'text' },
    { name: 'email', type: 'text' },
    { name: 'password_hash', type: 'text' },
  ]);
  assert.deepEqual([...map.entries()], [['email', 'pii'], ['password_hash', 'secret']]);
});
