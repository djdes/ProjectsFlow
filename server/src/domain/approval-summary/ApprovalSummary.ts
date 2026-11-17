// ИИ-сводка «что сделано» по задаче на утверждении (db/186): 2–3 короткие строки для
// руководителя на карточке полки «На утверждении». Хранится одна на задачу вместе с хэшем
// входа, из которого собрана, — пока вход тот же, модель повторно не спрашиваем.

export type StoredApprovalSummary = {
  readonly taskId: string;
  readonly inputHash: string;
  readonly summary: string;
  readonly generatedAt: Date;
};

// Ответ эндпоинта. summary=null — показывать нечего: задача не на утверждении, данных о
// работе нет совсем или подписка ИИ сейчас недоступна.
export type ApprovalSummaryResult = {
  readonly summary: string | null;
  readonly generatedAt: Date | null;
};

export const APPROVAL_SUMMARY_MAX_LINES = 3;
const MAX_LINE_CHARS = 220;

// Ответ модели → не больше трёх простых строк. Модель просят писать без markdown, но
// заголовки, маркеры списков и выделение всё равно иногда приходят — снимаем их здесь,
// чтобы карточка не показывала «## Итог» или «**…**».
export function normalizeApprovalSummary(raw: string): string | null {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // Заголовок — не строка сводки, а подпись к ней: выбрасываем целиком.
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:>\s*|[-*•·–—]\s+|\d{1,2}[.)]\s+)/, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0 && !/^(?:итог|сводка|резюме|summary)\s*:?$/i.test(line))
    .slice(0, APPROVAL_SUMMARY_MAX_LINES)
    .map((line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…` : line));
  return lines.length > 0 ? lines.join('\n') : null;
}
