import type { RalphMode, TaskPriority } from '@/domain/task/Task';

// Черновик быстрого создания задачи (нижний композер канбана). Сериализуемые поля —
// файлы сюда не входят (File-объекты не кладутся в sessionStorage). Используется и
// для «живого» черновика (переживает перезагрузку), и для stash'а «восстановить».
export type ComposerDraft = {
  readonly text: string;
  readonly ralphMode: RalphMode;
  readonly priority: TaskPriority | null;
  readonly deadline: string | null;
  readonly assigneeUserId: string | null;
};

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: '',
  ralphMode: 'normal',
  priority: null,
  deadline: null,
  assigneeUserId: null,
};

// Пустой черновик не храним и не предлагаем восстанавливать.
export function isEmptyComposerDraft(d: ComposerDraft): boolean {
  return (
    d.text.trim() === '' &&
    d.ralphMode === 'normal' &&
    d.priority === null &&
    d.deadline === null
  );
}

export function readComposerDraft(key: string): ComposerDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<ComposerDraft> & { delegateUserId?: string | null };
    if (typeof d?.text !== 'string') return null;
    return {
      text: d.text,
      ralphMode: (d.ralphMode as RalphMode) ?? 'normal',
      priority: (d.priority as TaskPriority) ?? null,
      deadline: d.deadline ?? null,
      // Старые локальные черновики мигрируют без потери выбранного человека.
      assigneeUserId: d.assigneeUserId ?? d.delegateUserId ?? null,
    };
  } catch {
    return null;
  }
}

export function writeComposerDraft(key: string, d: ComposerDraft): void {
  try {
    if (isEmptyComposerDraft(d)) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(d));
  } catch {
    /* sessionStorage недоступен — черновик действует только на эту сессию */
  }
}

export function clearComposerDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Ключ stash'а («восстановить прошлую задачу») для активного ключа черновика.
export function stashKeyFor(activeKey: string): string {
  return `${activeKey}:stash`;
}

// Переносит живой черновик колонки в stash (для «восстановить») и очищает живой.
// Вызывается при ЗАКРЫТИИ композера без создания (крестик / авто-закрытие).
export function stashComposerDraft(activeKey: string): void {
  const draft = readComposerDraft(activeKey);
  if (!draft || isEmptyComposerDraft(draft)) return;
  writeComposerDraft(stashKeyFor(activeKey), draft);
  clearComposerDraft(activeKey);
}
