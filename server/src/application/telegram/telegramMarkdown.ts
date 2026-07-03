// Конвертер Markdown → Telegram-HTML (parse_mode=HTML). Поддерживаемую разметку превращаем
// в теги Telegram (жирный/курсив/зачёркнутый/код/ссылка), а НЕподдерживаемые конструкции
// (заголовки, списки, hr, цитаты) — разворачиваем в текст и убираем символы-маркеры, чтобы
// сырые `**`, `#`, `-` и т.п. не «мешали» в сообщении.
//
// Telegram HTML разрешает лишь узкий набор тегов: b/i/u/s/code/pre/a/blockquote/tg-spoiler
// (см. https://core.telegram.org/bots/api#html-style). Всё, чего там нет, отображать нечем —
// поэтому маркеры срезаем. Порядок операций держит теги сбалансированными (иначе TG вернёт 400).

const PH_OPEN = '';
const PH_CLOSE = '';

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Строка целиком — тематический разделитель (`---`, `***`, `___`).
function isThematicBreak(line: string): boolean {
  return /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line.trim());
}

export function markdownToTelegramHtml(md: string): string {
  if (!md) return '';

  const stash: string[] = [];
  const keep = (html: string): string => {
    stash.push(html);
    return `${PH_OPEN}${stash.length - 1}${PH_CLOSE}`;
  };

  let s = md;

  // 1) Код (не трогаем разметкой внутри). Блочный ```…``` → <pre>, инлайн `…` → <code>.
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, code: string) =>
    keep(`<pre>${escapeTelegramHtml(code.replace(/\n$/, ''))}</pre>`),
  );
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => keep(`<code>${escapeTelegramHtml(code)}</code>`));

  // 2) Построчно: hr убираем, заголовки/списки/цитаты — разворачиваем в текст.
  s = s
    .split('\n')
    .filter((line) => !isThematicBreak(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // заголовок → просто текст
        .replace(/^(\s*)[-*+]\s+/, '$1• ') // список → буллет
        .replace(/^(\s*)(\d+)\.\s+/, '$1$2. ') // нумерованный — оставляем как есть
        .replace(/^\s{0,3}>\s?/, ''), // цитата → текст
    )
    .join('\n');

  // 3) Ссылки [text](url) → <a>. Держим отдельно, чтобы escape ниже не тронул href.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
    keep(`<a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(text)}</a>`),
  );

  // 4) Экранируем оставшийся текст (маркеры ** _ ~ выживают — превратим в теги ниже).
  s = escapeTelegramHtml(s);

  // 5) Инлайн-акценты. Жирный/зачёркнутый — раньше курсива, чтобы `**`/`__` не съел одиночный `*`/`_`.
  s = s.replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^\n]+?)__/g, '<b>$1</b>');
  s = s.replace(/~~([^\n]+?)~~/g, '<s>$1</s>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>');
  // Курсив `_x_` — только на границах слова (не ломаем snake_case).
  s = s.replace(/(?<![\p{L}\p{N}_])_([^_\n]+?)_(?![\p{L}\p{N}_])/gu, '<i>$1</i>');

  // 6) Убираем осевшие непарные маркеры (например, от обрезки excerpt'а) — «символы мешают».
  s = s.replace(/\*\*|__|~~|`/g, '');

  // 7) Возвращаем сохранённые код/ссылки.
  s = s.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_m, i: string) => stash[Number(i)] ?? '');

  return s;
}
