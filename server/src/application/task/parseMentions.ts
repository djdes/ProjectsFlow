import type { ProjectMemberWithUser } from '../project/ProjectMemberRepository.js';

// Парсит @-mentions из body против списка members. Один член может быть упомянут
// несколько раз — возвращаем уникальные user-id (исключая self). Алгоритм: для каждого
// member'а ищем `@${displayName}` как substring (case-insensitive). Это просто и
// предсказуемо: client-picker всегда вставляет exact-match по displayName.
//
// Вынесено из CreateTaskComment в отдельный модуль, чтобы переиспользовать в
// DispatchCommentNotifications (forced email упомянутым) без дублирования логики.
export function parseMentions(
  body: string,
  members: readonly ProjectMemberWithUser[],
  authorUserId: string,
): string[] {
  const lower = body.toLowerCase();
  const seen = new Set<string>();
  for (const m of members) {
    if (m.userId === authorUserId) continue;
    const needle = `@${m.user.displayName.toLowerCase()}`;
    if (lower.includes(needle)) seen.add(m.userId);
  }
  return [...seen];
}
