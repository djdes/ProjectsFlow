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

// Уровень заголовка по markdown-префиксу первой строки. 0 = обычный текст (без `#`).
export type TitleHeadingLevel = 0 | 1 | 2 | 3;
export type TitleHeading = { readonly text: string; readonly level: TitleHeadingLevel };

// Распарсить «сырую» первую строку: ведущие `#{1..6}` + пробел → уровень (клампим к 1–3,
// т.к. в UI только H1/H2/H3), остальное — чистый текст для отображения. Без `#` → level 0.
export function parseTitleHeading(rawTitle: string): TitleHeading {
  const m = /^(#{1,6})\s+([\s\S]*)$/.exec(rawTitle ?? '');
  if (m) {
    const level = Math.min(m[1].length, 3) as 1 | 2 | 3;
    return { text: m[2], level };
  }
  return { text: rawTitle ?? '', level: 0 };
}

// Собрать «сырую» первую строку из чистого текста + уровня. level>0 → `#`*level + ' ' + текст.
// Переносы в тексте схлопываем в пробелы (заголовок всегда однострочный).
export function formatTitleHeading(text: string, level: TitleHeadingLevel): string {
  const t = (text ?? '').replace(/\r?\n/g, ' ');
  return level > 0 ? `${'#'.repeat(level)} ${t}` : t;
}
