// Общие куски серверных исполнителей коротких заданий. Промпты перенесены из воркеров Ralph,
// где заполненный шаблон целиком уходил в claude -p через stdin, — здесь он так же идёт
// сообщением пользователя, а системная инструкция лишь задаёт рамку ответа.

export const RUN_PROMPT_INSTRUCTIONS =
  'Ты — ИИ-помощник платформы ProjectsFlow. Выполни инструкцию из сообщения пользователя точно и верни только требуемый результат, без вступлений и пояснений.';

// Подставляет {{KEY}} по очереди — как цепочка .Replace() в воркерах PowerShell.
export function fillPromptTemplate(template: string, values: Readonly<Record<string, string>>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(`{{${key}}}`).join(value);
  return out;
}
