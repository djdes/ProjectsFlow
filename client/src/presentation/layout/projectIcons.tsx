import { Folder, type LucideIcon } from 'lucide-react';

// Единая иконка для всех проектов: в модели больше нет поля type,
// категоризацию вернём позже через свободные теги. Иконка здесь —
// просто визуальный маркер строки списка, не носитель информации.
export const defaultProjectIcon: LucideIcon = Folder;

// Принимаем nullable: данные приходят из JSON-payload'ов notifications/memberships без
// runtime-валидации, и в проде встречались легаси-записи без display name (рушили
// NotificationsPage через `.trim()` of undefined).
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/u);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Детерминированный цвет аватара/инициалов по строке-сидну (имя, название проекта).
// Один и тот же человек/проект всегда одного цвета — глаз быстрее «цепляет» нужного
// в делегациях, комментариях, списке участников. Палитра — мягкие тинты поверх
// slate-нейтралей (bg/15 + насыщенный текст), хорошо читается в обеих темах.
const AVATAR_COLORS = [
  'bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300',
  'bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300',
  'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300',
  'bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300',
  'bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300',
  'bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300',
  'bg-violet-500/15 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300',
  'bg-fuchsia-500/15 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300',
  'bg-pink-500/15 text-pink-600 dark:bg-pink-400/15 dark:text-pink-300',
];

export function avatarColor(seed: string | null | undefined): string {
  const s = (seed ?? '').trim();
  if (!s) return 'bg-muted text-muted-foreground';
  // Простой стабильный хеш (djb2-ish), >>>0 чтобы остаться в uint32.
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
