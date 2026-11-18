// Ввод привычных названий проекта (db/192): через запятую или с новой строки, без пустых и
// повторов (без учёта регистра). Сервер нормализует так же — здесь для честного превью.
export function parseAliasInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n;]/)) {
    const value = part.replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = value.toLowerCase().replace(/ё/g, 'е');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 20) break;
  }
  return out;
}
