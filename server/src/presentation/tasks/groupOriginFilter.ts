// Фильтр «Только из групп» (db/190, groupOrigin): `?fromGroups=1` (или `true`) у списков задач
// оставляет только задачи, поставленные в рабочей Telegram-группе.

export function wantsFromGroups(query: Record<string, unknown>): boolean {
  const raw = query['fromGroups'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === '1' || value === 'true';
}

export function onlyFromGroups<T>(
  items: readonly T[],
  query: Record<string, unknown>,
  originOf: (item: T) => { readonly groupOrigin?: unknown },
): T[] {
  if (!wantsFromGroups(query)) return [...items];
  return items.filter((item) => originOf(item).groupOrigin != null);
}
