/**
 * Подсказка следующего промпта. Приезжает в `metadata` ассистентского сообщения
 * (ключ `suggestions`) — как и шаги агента, тела ответа не касается.
 *
 * Подпись короткая («Добавить галерею»), промпт длинный: чип — это ручка, а сообщение
 * пишется полным текстом. Своих подсказок клиент НЕ придумывает и списка не хардкодит:
 * нет поля в metadata — нет и блока подсказок.
 */
export type AiSuggestion = {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
};

// Пределы — на непроверенный JSON: подпись утекает в чип, промпт — в композер.
const MAX_TITLE = 80;
const MAX_PROMPT = 2_000;
const MAX_ITEMS = 12;

// Управляющие и форматирующие символы в чипе невидимы, но ломают вёрстку ряда.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]+/gu;

/**
 * Достать подсказки из metadata сообщения. Всё непонятное молча отбрасывается: лента
 * обязана выглядеть ровно как раньше для сообщений без подсказок (а это все старые).
 */
export function readAiSuggestions(metadata: unknown): AiSuggestion[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = (metadata as Record<string, unknown>)['suggestions'];
  if (!Array.isArray(raw)) return [];

  const items: AiSuggestion[] = [];
  for (const [index, entry] of raw.entries()) {
    // Сервер вправе прислать и голую строку (тогда подпись совпадает с промптом), и
    // пару «короткая подпись + длинный промпт». Остальные формы игнорируем.
    const source = typeof entry === 'string' ? { title: entry, prompt: entry } : entry;
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const record = source as Record<string, unknown>;

    // Промпт — то, что реально уйдёт в композер. Без него чип бесполезен.
    const prompt = text(record['prompt'], MAX_PROMPT) || text(record['title'], MAX_PROMPT);
    if (!prompt) continue;
    const title = text(record['title'], MAX_TITLE) || text(record['prompt'], MAX_TITLE);

    items.push({ id: `suggestion-${index + 1}`, title, prompt });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
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
