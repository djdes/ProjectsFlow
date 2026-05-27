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
