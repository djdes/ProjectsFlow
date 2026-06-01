// Фаззи-подбор проекта/участника по введённому query. Чистая функция — приоритет
// exact (ci) → prefix → substring. Используется конструктором: один матч → применяем
// молча; несколько → показываем пикер кнопками; ноль → показываем весь список.

export type Named = { readonly name: string };

export type FuzzyResult<T> = {
  // Единственный однозначный матч (exact, либо единственный prefix/substring). null если
  // кандидатов 0 или >1 на самом высоком сработавшем уровне.
  readonly unique: T | null;
  // Все кандидаты для пикера (в порядке релевантности). Пусто если query ничего не нашёл.
  readonly matches: readonly T[];
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

// items сопоставляются по полю, которое извлекает getName (имя проекта / displayName).
export function fuzzyMatch<T>(
  query: string,
  items: readonly T[],
  getName: (item: T) => string,
): FuzzyResult<T> {
  const q = norm(query);
  if (q.length === 0) {
    // Пустой query («+» или «@» без имени) → не матчим, отдаём весь список для пикера.
    return { unique: null, matches: items };
  }

  const exact = items.filter((it) => norm(getName(it)) === q);
  if (exact.length === 1) return { unique: exact[0] ?? null, matches: exact };
  if (exact.length > 1) return { unique: null, matches: exact };

  const prefix = items.filter((it) => norm(getName(it)).startsWith(q));
  if (prefix.length === 1) return { unique: prefix[0] ?? null, matches: prefix };
  if (prefix.length > 1) return { unique: null, matches: prefix };

  const substring = items.filter((it) => norm(getName(it)).includes(q));
  if (substring.length === 1) return { unique: substring[0] ?? null, matches: substring };
  return { unique: null, matches: substring };
}

// Жадный матч многословного имени проекта как словесного префикса сегмента
// «<проект> <текст>»: `+Ралф core Обнови билд` → проект «Ралф core», остаток «Обнови билд».
// Самое длинное подходящее имя выигрывает. null если ни одно имя не префикс — тогда caller
// откатывается на fuzzyMatch (одно-токенный query + пикер).
export function greedyProjectPrefix<T>(
  segment: string,
  items: readonly T[],
  getName: (item: T) => string,
): { readonly item: T; readonly remainder: string } | null {
  const seg = segment.trim();
  const segLow = seg.toLowerCase();
  let best: { item: T; nameLen: number } | null = null;
  for (const it of items) {
    const name = getName(it).trim();
    if (name.length === 0) continue;
    const nameLow = name.toLowerCase();
    // Точное совпадение или словесный префикс (имя + пробел), чтобы «Ралф» не матчил «Ралфмен».
    if (segLow === nameLow || segLow.startsWith(nameLow + ' ')) {
      if (!best || name.length > best.nameLen) best = { item: it, nameLen: name.length };
    }
  }
  if (!best) return null;
  return { item: best.item, remainder: seg.slice(best.nameLen).trim() };
}
