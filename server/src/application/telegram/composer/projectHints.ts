// Выбор проекта по тексту сообщения рабочей группы (spec 2026-11-17, раздел 2): название
// проекта, его привычные названия (aliases, db/192) или их основа («в планере» ↔ «Планер»).
// Чистая функция: однозначное совпадение — проект, иначе null (переспросить или ИИ).

export type HintedProject = {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
};

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Отдельное слово/фраза: по краям не буквы и не цифры.
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = escapeRe(phrase);
  return new RegExp(String.raw`(^|[^\p{L}\p{N}_])` + escaped + String.raw`(?=$|[^\p{L}\p{N}_])`, 'u').test(haystack);
}

// Основа однословного имени без окончания: только для достаточно длинных имён.
function stemOf(name: string): string | null {
  if (name.includes(' ')) return null;
  const cut = name.length >= 6 ? 2 : name.length >= 4 ? 1 : 0;
  return cut > 0 ? name.slice(0, name.length - cut) : null;
}

function stemHit(haystack: string, stem: string): boolean {
  const escaped = escapeRe(stem);
  return new RegExp(String.raw`(^|[^\p{L}\p{N}_])` + escaped, 'u').test(haystack);
}

const namesOf = (p: HintedProject): string[] =>
  [p.name, ...(p.aliases ?? [])].map(norm).filter((n) => n.length >= 2);

/**
 * Уровни по убыванию точности: точное название/псевдоним как слово → основа названия/псевдонима.
 * На каждом уровне ровно одно совпадение — ответ; несколько — null (спросить человека).
 */
export function pickProjectByHints<P extends HintedProject>(text: string, projects: readonly P[]): P | null {
  const haystack = norm(text);
  if (!haystack) return null;
  const exact = projects.filter((p) => namesOf(p).some((n) => containsPhrase(haystack, n)));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const stems = projects.filter((p) =>
    namesOf(p).some((n) => {
      const stem = stemOf(n);
      return stem !== null && stemHit(haystack, stem);
    }),
  );
  return stems.length === 1 ? stems[0]! : null;
}

// Псевдоним как `+запрос`: точное совпадение без регистра. Несколько — null.
export function matchProjectAlias<P extends HintedProject>(query: string, projects: readonly P[]): P | null {
  const q = norm(query);
  if (!q) return null;
  const hits = projects.filter((p) => (p.aliases ?? []).some((a) => norm(a) === q));
  return hits.length === 1 ? hits[0]! : null;
}

// Псевдонимы из ввода настроек: без пустых и повторов, не длиннее 60 символов, не больше 20.
export function normalizeAliases(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of raw) {
    const value = a.replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = norm(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 20) break;
  }
  return out;
}
