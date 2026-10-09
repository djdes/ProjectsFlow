import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import { escapeHtml } from '../../domain/task/digestFormat.js';

// Упоминание человека в сообщении бота (HTML). Публичный @username — обычным текстом:
// Telegram сам делает из него mention и присылает уведомление. Без username — ссылка
// tg://user на привязанный аккаунт. Telegram не привязан — просто имя: в общей сводке
// человек всё равно должен быть виден, даже если уведомление ему не придёт.
export function telegramPersonMention(displayName: string, link: TelegramLink | null): string {
  if (!link) return escapeHtml(displayName);
  const username = link.telegramUsername?.replace(/^@/, '').trim();
  if (username && /^[A-Za-z0-9_]{5,32}$/.test(username)) return `@${escapeHtml(username)}`;
  if (Number.isSafeInteger(link.telegramUserId) && link.telegramUserId > 0) {
    return `<a href="tg://user?id=${link.telegramUserId}">${escapeHtml(displayName)}</a>`;
  }
  return escapeHtml(displayName);
}
