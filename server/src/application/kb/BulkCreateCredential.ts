import matter from 'gray-matter';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import { FrontmatterInvalidError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { ProjectKbStore } from './ProjectKbStore.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { validateFrontmatter } from './FrontmatterValidator.js';
import type { SecretsRepository } from '../secrets/SecretsRepository.js';

// Слабый эвристический детектор «секретных» ключей. Триггерится по подстроке
// в имени поля; не пытается понять semantic, юзер увидит и подправит в preview.
const SECRET_KEY_RE = /pass(word)?|secret|token|api[_-]?key|private[_-]?key/i;

// Транслит для slug'а — чтобы кириллица в title не превращалась в "-".
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/./g, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export type ParsedField = {
  readonly key: string;
  readonly value: string;
  readonly isSecret: boolean;
};

export type ParsedBulk = {
  readonly title: string;
  readonly kind: string | null;
  readonly fields: readonly ParsedField[];
};

// Разделитель пары — `:` (yaml-style) ИЛИ `=` (env-style).
// Жадно берём первое вхождение, чтобы двоеточия внутри значения (URL'ы) не путали парсинг.
const KV_RE = /^([^:=]+)\s*[:=]\s*(.*)$/;

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseBulkText(raw: string): ParsedBulk {
  // Игнорируем пустые строки и .env-комментарии (#).
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) {
    return { title: 'Без названия', kind: null, fields: [] };
  }

  let title = 'Без названия';
  let kind: string | null = null;
  let startIdx = 0;

  const firstMatch = lines[0]!.match(KV_RE);
  if (firstMatch && firstMatch[2]!.trim().length > 0) {
    const candidateKind = firstMatch[1]!.trim();
    const candidateTitle = unquote(firstMatch[2]!.trim());
    // Эвристика «первая строка = KIND: TITLE»:
    // KIND — короткий буквенно-цифровой токен (≤10 символов, без `_`/`.`/пробелов),
    // т.е. «SSH», «DB», «REDIS», но НЕ «SSH_HOST» (это уже env-style поле).
    // Так env-блоки без явного заголовка не трактуются ошибочно.
    // KIND принимается только в ВЕРХНЕМ регистре: "SSH", "DB", "REDIS", "K8S".
    // Иначе обычные поля вроде "Host: ..." и "User: ..." ошибочно трактуются
    // как заголовок секции и съедают первую строку.
    const isKindLike = /^[A-Z][A-Z0-9-]{0,9}$/.test(candidateKind);
    if (isKindLike) {
      kind = candidateKind.toLowerCase();
      title = candidateTitle;
      startIdx = 1;
    }
  }

  const fields: ParsedField[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const m = lines[i]!.match(KV_RE);
    if (!m) continue;
    const rawKey = m[1]!.trim();
    const value = unquote(m[2]!.trim());
    if (value.length === 0) continue;
    const key = rawKey.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]+/g, '');
    if (key.length === 0) continue;
    fields.push({ key, value, isSecret: SECRET_KEY_RE.test(rawKey) });
  }

  return { title, kind, fields };
}

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly kb: ProjectKbStore;
  readonly secrets: SecretsRepository;
};

export type BulkCreateInput = {
  readonly projectId: string;
  readonly userId: string;
  // Текст в формате "KEY: VALUE" или "KEY=VALUE" по строке.
  // Первая строка может быть "KIND: TITLE" (короткий KIND — SSH/DB/REDIS — без подчёркиваний).
  readonly rawText: string;
  // Опционально: переопределить slug файла. По умолчанию — slugify(title).
  readonly fileSlugOverride: string | null;
  // Опционально: переопределить title (для .env-блоков без явного заголовка).
  readonly titleOverride: string | null;
  // Опционально: маска is-secret. Если передана — переопределяет эвристику.
  // key → isSecret. Используется когда client уже показал preview юзеру.
  readonly secretOverrides: Readonly<Record<string, boolean>> | null;
};

export type BulkCreateResult = {
  readonly path: string;        // "credentials/<slug>.md"
  readonly sha: string;
  readonly secretsWritten: readonly string[];   // полные ключи в vault
};

export class BulkCreateCredential {
  constructor(private readonly deps: Deps) {}

  async execute(input: BulkCreateInput): Promise<BulkCreateResult> {
    const { project } = await requireProjectAccess(this.deps, input.projectId, input.userId, 'manage_kb');
    if (project.kbKind === 'none') throw new KbNotConnectedError();

    const parsed = parseBulkText(input.rawText);
    const finalTitle = input.titleOverride?.trim() || parsed.title;

    const projectSlug = slugify(project.name);
    const fileSlug = input.fileSlugOverride?.trim() || slugify(finalTitle);
    if (fileSlug.length === 0) {
      throw new FrontmatterInvalidError([
        { code: 'title_missing', message: 'Из title не получилось сделать slug. Укажи fileSlugOverride.' },
      ]);
    }

    // Собираем frontmatter + список секретов для записи.
    const fm: Record<string, unknown> = { type: 'credential', title: finalTitle };
    if (parsed.kind) fm['kind'] = parsed.kind;

    const secretsToWrite: Array<{ key: string; value: string }> = [];
    for (const f of parsed.fields) {
      const isSecret = input.secretOverrides?.[f.key] ?? f.isSecret;
      if (isSecret) {
        const vaultKey = `${projectSlug}/${fileSlug}/${f.key}`;
        fm[`${f.key}_ref`] = `vault://${vaultKey}`;
        secretsToWrite.push({ key: vaultKey, value: f.value });
      } else {
        fm[f.key] = f.value;
      }
    }

    // Валидируем результирующий frontmatter теми же правилами, что и обычный write.
    const errors = validateFrontmatter(fm as Frontmatter, '');
    if (errors.length > 0) throw new FrontmatterInvalidError(errors);

    // Сначала пишем секреты в vault (если что-то упадёт — не плодим файл с висящими ref'ами).
    // Scope — проект: креды общие для всех участников. input.userId идёт как audit.
    for (const s of secretsToWrite) {
      await this.deps.secrets.upsert(project.id, s.key, s.value, input.userId);
    }

    // Потом — markdown-документ в KB (github или local — решает DispatchingKbStore).
    const content = matter.stringify('', fm);
    const path = `credentials/${fileSlug}.md`;
    const { sha } = await this.deps.kb.write(project, {
      path,
      content,
      message: `chore(kb): bulk-create credential ${fileSlug}`,
      sha: null,
    });

    return { path, sha, secretsWritten: secretsToWrite.map((s) => s.key) };
  }
}
