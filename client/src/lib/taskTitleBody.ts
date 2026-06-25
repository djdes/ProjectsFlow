// Notion-style разделение единого markdown-описания задачи на ЗАГОЛОВОК и ТЕЛО.
// Доменная модель хранит только `description` (markdown) — отдельного поля title нет.
// Заголовок = первая строка (plain-текст, без markdown), тело = всё остальное (markdown).
// Разделитель — ПЕРВЫЙ перевод строки. Это чисто presentation-уровень: round-trip
// через `description` обязан быть без потерь (см. taskTitleBody.test.ts).

export type TitleBody = {
  readonly title: string;
  readonly body: string;
};

// Разбить описание по первому '\n': title = первая строка, body = остаток (с переносами).
// Нет переноса строки → всё описание это заголовок, тело пустое.
export function splitTitleBody(description: string): TitleBody {
  const src = description ?? '';
  const nl = src.indexOf('\n');
  if (nl === -1) {
    return { title: src, body: '' };
  }
  return { title: src.slice(0, nl), body: src.slice(nl + 1) };
}

// Склеить заголовок и тело обратно в единое описание. Заголовок тримим (это одна
// строка), тело пишем как есть (markdown с собственными переносами). Пустое тело →
// description это просто заголовок (без хвостового '\n').
export function joinTitleBody(title: string, body: string): string {
  const t = (title ?? '').trim();
  const b = body ?? '';
  return b.length > 0 ? `${t}\n${b}` : t;
}
