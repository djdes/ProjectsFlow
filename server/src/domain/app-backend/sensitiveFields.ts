// Классификация полей пользовательской схемы как секретов / PII и маскирование значений
// в выдаче Data Explorer. Схема приложения пишется воркером и не содержит явной пометки
// «это секрет», поэтому единственный доступный сигнал — имя поля. Разбираем имя на токены
// (snake_case, kebab-case и camelCase), чтобы `keyword` не считался `key`, а `api_key` считался.

import type { AppField } from './AppSchema.js';

export type SensitiveKind = 'secret' | 'pii';

// Секреты: значение не показываем никогда, даже частично — по нему нельзя восстановить
// исходную строку. PII: маскируем частично, оставляя ровно столько, чтобы админ проекта
// узнал запись (домен почты, последние цифры телефона).
const SECRET_TOKENS = new Set([
  'password', 'passwd', 'pwd', 'passphrase', 'secret', 'token', 'apikey', 'key', 'hash', 'salt',
  'credential', 'credentials', 'private', 'signature', 'otp', 'totp', 'mfa', 'pin', 'cvv', 'cvc',
  'seed', 'jwt', 'bearer', 'auth', 'refresh', 'nonce',
]);

// `code` сам по себе не секрет (country_code, promo_code), но recovery/backup code — секрет.
const SECRET_CODE_QUALIFIERS = new Set(['recovery', 'backup']);

const PII_TOKENS = new Set([
  'email', 'mail', 'phone', 'tel', 'telephone', 'mobile', 'passport', 'inn', 'snils',
  'ssn', 'iban', 'card', 'pan', 'birthdate', 'birthday', 'dob', 'address',
]);

export const SECRET_MASK = '••••••••';

export function tokenizeFieldName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function classifyField(name: string): SensitiveKind | null {
  const tokens = tokenizeFieldName(name);
  if (tokens.some((token) => SECRET_TOKENS.has(token))) return 'secret';
  if (tokens.includes('code') && tokens.some((token) => SECRET_CODE_QUALIFIERS.has(token))) {
    return 'secret';
  }
  if (tokens.some((token) => PII_TOKENS.has(token))) return 'pii';
  return null;
}

export function maskValue(value: unknown, kind: SensitiveKind): unknown {
  if (value === null || value === undefined || value === '') return value;
  if (kind === 'secret') return SECRET_MASK;
  return maskPii(String(value));
}

function maskPii(value: string): string {
  const at = value.indexOf('@');
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return `${keepHead(local, 1)}@${maskDomain(domain)}`;
  }
  const digits = value.replace(/\D/g, '');
  // Телефоны/номера документов узнаваемы по хвосту — оставляем 4 последние цифры.
  if (digits.length >= 6 && digits.length / value.length > 0.5) {
    return `${'•'.repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`;
  }
  return keepHead(value, 2);
}

// Домен почты нужен админу целиком в части зоны: `mail.ru` → `m•••.ru`.
function maskDomain(domain: string): string {
  const dot = domain.lastIndexOf('.');
  if (dot <= 0) return keepHead(domain, 1);
  return `${keepHead(domain.slice(0, dot), 1)}${domain.slice(dot)}`;
}

function keepHead(value: string, keep: number): string {
  if (value.length <= keep) return '•'.repeat(Math.max(1, value.length));
  return `${value.slice(0, keep)}${'•'.repeat(Math.min(8, value.length - keep))}`;
}

// Колонки таблицы, значения которых уходят клиенту только замаскированными.
export function sensitiveColumns(fields: readonly AppField[]): Map<string, SensitiveKind> {
  const result = new Map<string, SensitiveKind>();
  for (const field of fields) {
    const kind = classifyField(field.name);
    if (kind) result.set(field.name, kind);
  }
  return result;
}
