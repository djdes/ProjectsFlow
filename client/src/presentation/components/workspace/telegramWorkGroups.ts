// Чистые хелперы карточки «Telegram-группы» (рабочие группы пространства, db/181).

// Id Telegram-группы из поля ввода. У групп и супергрупп он отрицательный (супергруппы —
// «-100…»). Принимаем типографский минус и пробелы из копипасты; остальное — не id.
export function parseChatIdInput(input: string): number | null {
  const normalized = input.trim().replace(/[−‒–—]/g, '-').replace(/\s+/g, '');
  if (!/^-\d{1,20}$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : null;
}

// Группа, которой не было, когда открыли окно «Подключить группу», — её и подключили сейчас.
export function findNewGroup<T extends { readonly chatId: number }>(
  knownChatIds: readonly number[],
  groups: readonly T[],
): T | null {
  const known = new Set(knownChatIds);
  return groups.find((group) => !known.has(group.chatId)) ?? null;
}

// Подпись группы в списке: название или id, если бот не знает названия.
export function groupLabel(group: { readonly chatId: number; readonly title: string | null }): string {
  return group.title?.trim() || `Группа ${group.chatId}`;
}
