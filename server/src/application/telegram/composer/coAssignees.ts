// Совместная задача нескольким исполнителям (Telegram, решение владельца 2026-11-18).
//
// «@Бот сделать отчёт @Вася @Петя» — каждому названному человеку ставится СВОЯ копия одной и
// той же задачи: они начинают её вместе, у каждого она в своих задачах и со своим статусом.
// В перефразированном описании каждой копии перечислены все ответственные исполнители — так
// каждый видит, с кем делит работу.
//
// Чистые функции без I/O: разбор @упоминаний, текст для ИИ и размножение сегментов черновика.
// Резолв «имя → участник» делает TelegramComposerService.

import type { TelegramDraftSegment } from '../TelegramTaskDraftRepository.js';

export type CoAssignee = { readonly userId: string; readonly displayName: string };

// Все @упоминания людей в порядке появления, без повторов. Хвостовая пунктуация срезается:
// «@Вася, @Петя» — частая запись, а «Вася,» не сматчится ни по имени, ни по @username.
// Голое «@» (без имени) пропускается. «@бот»/«@воркер» вырезаются раньше, до этого разбора.
export function extractAssigneeQueries(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of raw.trim().split(/\s+/)) {
    if (!token.startsWith('@')) continue;
    const name = token.slice(1).replace(/[.,:;!?)]+$/u, '');
    if (name.length === 0) continue;
    const key = name.toLocaleLowerCase('ru');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function coAssigneeNames(assignees: readonly CoAssignee[]): string {
  return assignees.map((a) => a.displayName.trim() || 'участник').join(', ');
}

// Подсказка модели: одна общая задача, людей не делить — копии бот раздаст сам.
export function coAssigneeAiText(taskText: string, assignees: readonly CoAssignee[]): string {
  return (
    `${taskText.trim()}\n\n` +
    `Ответственные исполнители (делают задачу совместно, НЕ дели её по людям): ${coAssigneeNames(assignees)}`
  );
}

const NOTE_PREFIX = '👥 **Ответственные исполнители:**';

// Строка в перефразированном описании: кто участвует в задаче.
export function coAssigneeNote(assignees: readonly CoAssignee[]): string {
  return `${NOTE_PREFIX} ${coAssigneeNames(assignees)} — задача общая, делаете её совместно.`;
}

export function withCoAssigneeNote(body: string, assignees: readonly CoAssignee[]): string {
  const clean = body.trimEnd();
  // Повторное размножение (повтор разбора, сырой фолбэк) не должно дублировать строку.
  const withoutOld = clean
    .split('\n')
    .filter((line) => !line.startsWith(NOTE_PREFIX))
    .join('\n')
    .trimEnd();
  const note = coAssigneeNote(assignees);
  return withoutOld.length > 0 ? `${withoutOld}\n\n${note}` : note;
}

// Исполнители совместной задачи, сохранённые в сегментах черновика (поле переживает
// перезапуск процесса и повтор разбора). Пустой массив — обычный черновик.
export function coAssigneesOf(segments: readonly TelegramDraftSegment[] | null | undefined): CoAssignee[] {
  for (const segment of segments ?? []) {
    if (segment.coAssignees && segment.coAssignees.length >= 2) return [...segment.coAssignees];
  }
  return [];
}

export type CoAssigneeFanOut = {
  readonly segments: TelegramDraftSegment[];
  // origin[i] — индекс исходного сегмента, из которого получился i-й результат.
  readonly origin: number[];
};

// Каждый сегмент (кроме дополнения существующей задачи) → по копии на исполнителя: тот же
// текст, проект, срок и колонка, свой ответственный и строка со всеми исполнителями.
// Дополнение уже существующей задачи (existingTaskId) остаётся одним сегментом: это не новая
// задача, а комментарий/правка той, что уже есть.
export function fanOutCoAssignees(
  segments: readonly TelegramDraftSegment[],
  assignees: readonly CoAssignee[],
): CoAssigneeFanOut {
  const out: TelegramDraftSegment[] = [];
  const origin: number[] = [];
  segments.forEach((segment, index) => {
    if (segment.existingTaskId) {
      out.push(segment);
      origin.push(index);
      return;
    }
    const body = withCoAssigneeNote(segment.body, assignees);
    for (const assignee of assignees) {
      out.push({
        ...segment,
        body,
        assigneeUserId: assignee.userId,
        assigneeName: null,
        coAssignees: assignees,
      });
      origin.push(index);
    }
  });
  return { segments: out, origin };
}
