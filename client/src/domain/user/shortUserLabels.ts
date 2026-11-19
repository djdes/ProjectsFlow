// Short names for a row of people chips: the first name is enough until two people share
// it — then the initial of the next word tells them apart («Олег Б.», «Олег К.»), and
// when even that is not available the full label stays.
export function shortUserLabels(
  people: ReadonlyArray<{ readonly id: string; readonly label: string }>,
): Map<string, string> {
  const first = (label: string): string => {
    const text = label.trim();
    // An e-mail instead of a name: its local part reads as the name.
    if (!/\s/u.test(text) && text.includes('@')) return text.slice(0, text.indexOf('@')) || text;
    return text.split(/\s+/u)[0] ?? text;
  };
  const counts = new Map<string, number>();
  for (const person of people) {
    const key = first(person.label).toLocaleLowerCase('ru');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const person of people) {
    const name = first(person.label);
    if ((counts.get(name.toLocaleLowerCase('ru')) ?? 0) < 2) {
      result.set(person.id, name);
      continue;
    }
    const next = person.label.trim().split(/\s+/u)[1];
    result.set(person.id, next ? `${name} ${next[0]!.toLocaleUpperCase('ru')}.` : person.label.trim());
  }
  return result;
}
