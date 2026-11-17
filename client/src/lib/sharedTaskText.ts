// «Поделиться → ProjectsFlow» (Web Share Target): из title / text / url, которые прислала
// система, собираем текст новой задачи. Первая строка — название (как везде в продукте):
// заголовок страницы, иначе первая строка текста, иначе ссылка. Ссылка уходит в тело, если
// её ещё нет в тексте.
export function composeSharedTaskText(input: { title?: string | null; text?: string | null; url?: string | null }): string {
  const title = (input.title ?? '').trim();
  const text = (input.text ?? '').trim();
  const url = (input.url ?? '').trim();
  const lines = text ? text.split(/\r?\n/) : [];
  let head = title;
  let body = lines;
  if (!head && lines.length > 0) {
    head = (lines[0] ?? '').trim();
    body = lines.slice(1);
  }
  if (!head) head = url;
  const rest = body.join('\n').trim();
  const parts = [head];
  if (rest) parts.push(rest);
  if (url && url !== head && !text.includes(url)) parts.push(url);
  return parts.filter(Boolean).join('\n');
}
