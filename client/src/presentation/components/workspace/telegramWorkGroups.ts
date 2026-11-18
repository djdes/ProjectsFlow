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

// Черновики (ждут подтверждения) — отдельным блоком над рабочими группами (db/189).
export function splitGroupsByStatus<T extends { readonly status: 'draft' | 'active' | 'disconnected' }>(
  groups: readonly T[],
): { drafts: T[]; connected: T[] } {
  return {
    drafts: groups.filter((group) => group.status === 'draft'),
    connected: groups.filter((group) => group.status !== 'draft'),
  };
}

// Чипы проектов группы: только известные проекты пространства, в порядке выбора.
export function groupProjects<P extends { readonly id: string }>(
  projectIds: readonly string[],
  projects: readonly P[],
): P[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return projectIds.map((id) => byId.get(id)).filter((project): project is P => project !== undefined);
}

// Кандидаты для «Добавить проект»: проекты пространства, которых ещё нет у группы.
export function addableProjects<P extends { readonly id: string }>(
  projectIds: readonly string[],
  projects: readonly P[],
): P[] {
  const taken = new Set(projectIds);
  return projects.filter((project) => !taken.has(project.id));
}

// Подпись группы в списке: название или id, если бот не знает названия.
export function groupLabel(group: { readonly chatId: number; readonly title: string | null }): string {
  return group.title?.trim() || `Группа ${group.chatId}`;
}

// Тост после смены режима группы.
export function groupModeToast(mode: 'standard' | 'incident' | 'mixed'): string {
  if (mode === 'incident') return 'Группа переведена в режим инцидентов';
  if (mode === 'mixed') return 'Группа переведена в смешанный режим';
  return 'Группа снова обычная';
}

// Подсказка к переключателю режима группы (spec 2026-11-17, раздел 3).
export function groupModeHint(mode: 'standard' | 'incident' | 'mixed', hasProjects: boolean): string {
  if (mode === 'standard') return 'Участники ставят задачи через бота, бот перефразирует и уточняет детали.';
  if (mode === 'mixed') {
    return hasProjects
      ? 'Указан исполнитель (@username, имя или «@мне») — задача ему. Не указан — задача воркеру в проект группы, ответ придёт сюда простым языком.'
      : 'Выберите проекты группы — без них задачи воркеру не принимаются.';
  }
  return hasProjects
    ? 'Любой участник пишет о проблеме — задача молча уходит воркеру в проект группы, ответ придёт сюда простым языком.'
    : 'Выберите проекты группы — без них сообщения об инцидентах не принимаются.';
}
