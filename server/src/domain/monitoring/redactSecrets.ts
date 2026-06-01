// Скраб секретов в тексте логов. Применяется двухслойно: на сборщике (перед пушем)
// и на сервере (перед записью в БД и перед отдачей в API). Лучше переусердствовать —
// логи мониторинга читает владелец, но утечка токена в БД/ответе недопустима.

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Authorization: Bearer <...>
  [/\b(bearer)\s+[A-Za-z0-9._\-]+/gi, '$1 «redacted»'],
  // query/JSON ключи с секретными значениями: token=..., access_token: "...", api_key=...
  [
    /\b(token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|password|passwd|pwd|authorization|auth)([=:]\s*"?)[^\s"&]+/gi,
    '$1$2«redacted»',
  ],
  // GitHub PAT / fine-grained / OAuth
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '«redacted-gh-token»'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '«redacted-gh-pat»'],
  // AWS access key id
  [/\bAKIA[0-9A-Z]{16}\b/g, '«redacted-aws-key»'],
  // JWT (three base64url segments)
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '«redacted-jwt»'],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, repl] of PATTERNS) {
    out = out.replace(re, repl);
  }
  return out;
}
