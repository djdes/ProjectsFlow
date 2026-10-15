// Сжатый контекст compose для запасной модели (см. FallbackLlmTextGenerator): у неё лимит ~8 тыс.
// токенов на запрос, а полный контекст с дайджестами базы знаний и списками задач — 12–18 тыс.
// Оставляем то, без чего не выбрать проект и ответственного: проекты (с id и пространством) и
// участников. Дайджесты и открытые задачи (кандидаты на дополнение) отбрасываем.
const KEEP_LINE = /^(\[projectId=|Пространство:|Участники)/;

export function liteComposeContext(block: string, maxChars = 8_000): string {
  const parts = block.split('\n\n---\n\n');
  const today = /^Сегодня: .*$/m.exec(block)?.[0] ?? null;
  const kept: string[] = [];
  let total = 0;
  for (const part of parts) {
    const lines = part.split('\n').filter((line) => KEEP_LINE.test(line));
    const header = lines.find((line) => line.startsWith('[projectId='));
    if (!header) continue;
    const full = lines.join('\n');
    // Не влезает с участниками — хотя бы название проекта: его модель обязана уметь выбрать.
    const piece = total + full.length <= maxChars ? full : header;
    if (total + piece.length > maxChars) break;
    kept.push(piece);
    total += piece.length;
  }
  if (kept.length === 0) return '(нет проектов-кандидатов)';
  return [today, kept.join('\n\n')].filter(Boolean).join('\n\n');
}
