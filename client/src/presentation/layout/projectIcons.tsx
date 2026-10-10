import { Folder, type LucideIcon } from 'lucide-react';
import { toneClass, toneOf } from '@/lib/tone';

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
// в делегациях, комментариях, списке участников. Палитра — тона Notion (lib/tone.ts):
// в светлой теме пастельная заливка с тёмными буквами, в тёмной — яркая с тёмными.
export function avatarColor(seed: string | null | undefined): string {
  const s = (seed ?? '').trim();
  if (!s) return 'bg-muted text-muted-foreground';
  return `${toneClass(toneOf(s))} bg-tone-solid text-tone-on-solid`;
}
