import type { TaskPriority } from './Task.js';

// Метаданные приоритета для дайджеста: short (P1..P4), русский label, эмодзи-маркер.
// Цвета-эмодзи синхронизированы с client PRIORITY_META (rose/orange/blue/slate).
export const PRIORITY_DIGEST_META: Record<TaskPriority, { short: string; label: string; emoji: string }> = {
  1: { short: 'P1', label: 'Срочно', emoji: '🔴' },
  2: { short: 'P2', label: 'Высокий', emoji: '🟠' },
  3: { short: 'P3', label: 'Средний', emoji: '🔵' },
  4: { short: 'P4', label: 'Низкий', emoji: '⚪' },
};

export const NO_PRIORITY_LABEL = 'Без приоритета';

// Имя задачи = первая непустая строка описания, очищенная от inline-markdown, ≤ maxLen.
// У задачи нет поля title — описание (markdown) единственный носитель «названия».
export function taskNameFromDescription(description: string | null, maxLen = 80): string {
  const raw = (description ?? '').replace(/\r/g, '');
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const stripped = stripMarkdownInline(firstLine ?? '');
  if (stripped.length === 0) return '(без описания)';
  return stripped.length <= maxLen ? stripped : stripped.slice(0, maxLen - 1).trimEnd() + '…';
}

// Грубая чистка inline-markdown одной строки-заголовка (заголовки/буллеты/ссылки/код/жирный).
function stripMarkdownInline(s: string): string {
  return s
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// RU-дата дедлайна: «сегодня/завтра/вчера» для близких, иначе «5 июн» / «5 июн 2026».
export function formatDeadlineRu(iso: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'завтра';
  if (diffDays === -1) return 'вчера';
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Экранирование спецсимволов Telegram MarkdownV2 (вне ссылочного URL).
export function escapeMarkdownV2(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => '\\' + c);
}

// Экранирование URL внутри inline-ссылки MarkdownV2 [текст](url): только ) и \.
export function escapeMarkdownV2Url(url: string): string {
  return url.replace(/[)\\]/g, (c) => '\\' + c);
}
