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
 * Уровни по убыванию точности: точное название/псевдоним как слово → основа → фонетический транслит.
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
  if (stems.length === 1) return stems[0]!;
  if (stems.length > 1) return null;
  // Транслит: «есбит» ↔ Yesbeat, «конфиг» ↔ Config, «фильтрмьюзик» ↔ FilterMusic.
  const phonetic = projects.filter((p) => phoneticHit(text, p));
  return phonetic.length === 1 ? phonetic[0]! : null;
}

// ---- Фонетический ключ (русский транслит ↔ латинское название) ----

const RU_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Латинский фонетический ключ: транслит, без регистра/пробелов/знаков, c→k/s, ea/ee/ie→i,
// без y/j-призвуков, z→s, без удвоений. «C#» в начале названия отбрасывается.
export function phoneticKey(raw: string): string {
  let s = raw.toLowerCase().replace(/^\s*c#\s*/, '');
  s = [...s].map((ch) => RU_LAT[ch] ?? ch).join('').replace(/[^a-z0-9]/g, '');
  s = s
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'kv').replace(/x/g, 'ks')
    .replace(/w/g, 'v').replace(/th/g, 't').replace(/kh/g, 'h').replace(/dzh/g, 'zh').replace(/j/g, 'zh')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/ea|ee|ie/g, 'i')
    .replace(/y/g, '')
    .replace(/z(?!h)/g, 's')
    .replace(/(.)\1+/g, '$1');
  return s;
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

// Слово (или 2–3 подряд, для «фильтр мьюзик») совпадает с ключом названия: точно, основой
// (название + до 2 букв окончания, «в есбите») или с опечаткой для длинных (≥5: 1, ≥9: 2).
function phoneticHit(text: string, project: HintedProject): boolean {
  const words = text.split(/[^\p{L}\p{N}#]+/u).map(phoneticKey).filter(Boolean);
  const windows: string[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) windows.push(words.slice(i, i + n).join(''));
  }
  const keys = [project.name, ...(project.aliases ?? [])].map(phoneticKey).filter((k) => k.length >= 3);
  return keys.some((key) => {
    const tolerance = key.length >= 9 ? 2 : key.length >= 5 ? 1 : 0;
    return windows.some(
      (w) =>
        w === key ||
        (key.length >= 4 && w.startsWith(key) && w.length - key.length <= 2) ||
        // Падеж меняет конечную гласную: «касса» → «в кассе».
        (key.length >= 4 && /[aeiou]$/.test(key) && w.startsWith(key.slice(0, -1)) && w.length - key.length <= 1) ||
        (tolerance > 0 && editDistance(w, key, tolerance) <= tolerance),
    );
  });
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
