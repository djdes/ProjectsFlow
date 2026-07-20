/**
 * Подсказка следующего промпта. Хранится в `metadata_json` ассистентского сообщения
 * (ключ `suggestions`) рядом с шагами и источниками — тела ответа не касается.
 *
 * Клиентское зеркало — `client/src/domain/ai-chat/AiSuggestion.ts`: там те же пределы,
 * потому что metadata приезжает в браузер как непроверенный JSON. Подпись короткая
 * («Добавить галерею»), промпт длинный: чип — это ручка, а в композер уходит полный текст.
 */
export type AiSuggestion = {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
};

export const MAX_AI_SUGGESTIONS = 12;
export const MAX_AI_SUGGESTION_TITLE = 80;
export const MAX_AI_SUGGESTION_PROMPT = 2_000;

// Управляющие и форматирующие символы в чипе невидимы, но ломают вёрстку ряда.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]+/gu;

type RawSuggestion = {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly prompt?: unknown;
};

/**
 * Привести подсказки воркера к домену. Как и у шагов агента, кривой элемент не роняет
 * весь ответ — он отбрасывается: ответ пользователю важнее полноты подсказок.
 */
export function normalizeAiSuggestions(value: unknown): AiSuggestion[] {
  if (!Array.isArray(value)) return [];
  const suggestions: AiSuggestion[] = [];
  for (const [index, raw] of value.entries()) {
    if (suggestions.length >= MAX_AI_SUGGESTIONS) break;
    // Голая строка — законная краткая форма: подпись совпадает с промптом.
    const source = typeof raw === 'string' ? { title: raw, prompt: raw } : raw;
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const entry = source as RawSuggestion;

    // Промпт — то, что реально уйдёт в композер. Без него чип бесполезен.
    const prompt = text(entry.prompt, MAX_AI_SUGGESTION_PROMPT) || text(entry.title, MAX_AI_SUGGESTION_PROMPT);
    if (!prompt) continue;
    suggestions.push({
      id: typeof entry.id === 'string' && entry.id.trim()
        ? entry.id.trim().slice(0, 80)
        : `suggestion-${index + 1}`,
      title: text(entry.title, MAX_AI_SUGGESTION_TITLE) || text(entry.prompt, MAX_AI_SUGGESTION_TITLE),
      prompt,
    });
  }
  return suggestions;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
    .trim();
}
