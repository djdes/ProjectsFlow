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

// Есть ли несохранённые изменения в карточке подсказок группы (db/192 + флаг db/193).
export function isGroupHintsDirty(
  saved: { readonly aliases: readonly string[]; readonly shortDescription: string | null; readonly groupFullRunDefault: boolean },
  draft: { readonly aliases: readonly string[]; readonly description: string; readonly fullRun: boolean },
): boolean {
  return (
    draft.aliases.join('\n') !== saved.aliases.join('\n') ||
    (draft.description.trim() || null) !== (saved.shortDescription ?? null) ||
    draft.fullRun !== saved.groupFullRunDefault
  );
}
