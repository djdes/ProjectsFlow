import type { Frontmatter, KbDocumentType } from '../../domain/kb/Frontmatter.js';
import type { ValidationError } from '../../domain/kb/KbDocument.js';

const VALID_TYPES = new Set<KbDocumentType>([
  'credential', 'decision', 'service', 'schema', 'runbook', 'note', 'agent', 'monitoring',
]);

const REF_KEY_RE = /_ref$/;
const VAULT_VALUE_RE = /^vault:\/\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

// Простая эвристика для «голого секрета» в body или frontmatter-значении:
// (a) ≥32 символа hex или base64-ish без пробелов, (b) контекст «password:»/«token:».
const LIKELY_SECRET_RE = /(password|token|api[-_]?key|secret)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}['"]?/i;

export function validateFrontmatter(
  fm: Frontmatter,
  body: string,
): readonly ValidationError[] {
  const errors: ValidationError[] = [];

  const type = fm['type'];
  if (typeof type !== 'string') {
    errors.push({ code: 'type_missing', message: 'frontmatter must have type field' });
    return errors;
  }
  if (!VALID_TYPES.has(type as KbDocumentType)) {
    errors.push({ code: 'type_invalid', message: `unknown type "${type}"` });
  }

  const title = fm['title'];
  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.push({ code: 'title_missing', message: 'frontmatter must have non-empty title' });
  }

  if (type === 'credential') {
    // Раньше требовали наличие хотя бы одного *_ref-поля (credential обязан иметь секрет).
    // Сняли: бывают «креды» из чисто публичных полей (path/scope/url/rotated_at) — это
    // нормальный use-case (например, метаданные ротации, ссылки на runbook'и). Если секреты
    // всё-таки указаны через *_ref — формат проверяем ниже как и раньше.
    const refKeys = Object.keys(fm).filter((k) => REF_KEY_RE.test(k));
    for (const k of refKeys) {
      const v = fm[k];
      if (typeof v !== 'string' || !VAULT_VALUE_RE.test(v)) {
        errors.push({
          code: 'ref_format',
          message: `${k} must be vault://<project>/<file>/<field>, got "${String(v)}"`,
        });
      }
    }

    // Проверка на голый секрет в body или в other-frontmatter-полях
    if (LIKELY_SECRET_RE.test(body)) {
      errors.push({
        code: 'naked_secret_in_body',
        message: 'body looks to contain a raw secret — use vault:// reference instead',
      });
    }
    for (const [k, v] of Object.entries(fm)) {
      if (REF_KEY_RE.test(k)) continue;
      if (typeof v === 'string' && LIKELY_SECRET_RE.test(`${k}: ${v}`)) {
        errors.push({
          code: 'naked_secret_in_frontmatter',
          message: `frontmatter "${k}" looks like a raw secret — use ${k}_ref: vault://...`,
        });
      }
    }
  }

  return errors;
}
