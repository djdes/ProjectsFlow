// Парсер сообщения-конструктора TG-бота: `+проект текст задачи @ответственный`.
// Чистая функция (без I/O) — легко тестируется. Резолв query→UUID делает сервис.
//
// Правила:
//   • Первый токен, начинающийся с '+', — это проект. '+' без имени ('+ текст') → пустой
//     query = «показать все проекты». Только ПЕРВЫЙ токен считается проектом (избегаем
//     ложных срабатываний на '+' в середине текста).
//   • Любой токен, начинающийся с '@', — кандидат в ответственные; берём ПОСЛЕДНИЙ ('@' без
//     имени → пустой query = «показать участников»). Все '@'-токены убираются из текста.
//   • Остальное — текст задачи.

export type ParsedComposerMessage = {
  // null = '+' не указан вовсе; '' = '+' без имени проекта.
  readonly projectQuery: string | null;
  readonly taskText: string;
  // null = '@' не указан вовсе; '' = '@' без имени.
  readonly assigneeQuery: string | null;
};

export function parseComposerMessage(raw: string): ParsedComposerMessage {
  const trimmed = raw.trim();
  const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/);

  let projectQuery: string | null = null;
  let assigneeQuery: string | null = null;
  const textTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? '';
    if (i === 0 && tok.startsWith('+')) {
      projectQuery = tok.slice(1);
      continue;
    }
    if (tok.startsWith('@')) {
      // Последний '@' выигрывает; все '@'-токены исключаются из текста.
      assigneeQuery = tok.slice(1);
      continue;
    }
    textTokens.push(tok);
  }

  return { projectQuery, taskText: textTokens.join(' '), assigneeQuery };
}
