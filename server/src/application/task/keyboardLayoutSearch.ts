const ENGLISH_LAYOUT = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,./';
const RUSSIAN_LAYOUT = 'ёйцукенгшщзхъфывапролджэячсмитьбю.';

function translateLayout(value: string, source: string, target: string): string {
  return [...value].map((character) => {
    const lower = character.toLocaleLowerCase('ru');
    const index = source.indexOf(lower);
    if (index < 0) return character;
    const translated = target[index] ?? character;
    return character === lower ? translated : translated.toLocaleUpperCase('ru');
  }).join('');
}

export function keyboardLayoutQueryVariants(rawQuery: string): string[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const candidates = [
    query,
    translateLayout(query, ENGLISH_LAYOUT, RUSSIAN_LAYOUT),
    translateLayout(query, RUSSIAN_LAYOUT, ENGLISH_LAYOUT),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.toLocaleLowerCase('ru');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
