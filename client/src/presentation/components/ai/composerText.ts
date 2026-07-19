export const AI_COMPOSER_MAX_LENGTH = 50_000;

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DD', 'DT', 'FIGURE', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TR', 'UL',
]);

// Zs = любой пробельный разделитель: contenteditable подставляет неразрывный пробел
// в конце строки, и без нормализации он уезжает в тело сообщения.
const SPACE_SEPARATORS = /\p{Zs}/gu;
const CONTROL_CHARS = /\p{Cc}/gu;

/**
 * `innerText` зависит от раскладки и в headless-DOM (happy-dom) не реализован, а
 * `textContent` теряет переносы: contenteditable хранит их как <br> или как границу
 * блока. Поэтому собираем plain text обходом узлов — это единственный источник
 * правды о содержимом композера.
 */
export function plainTextFromEditable(root: Node): string {
  let out = '';

  const breakLine = (): void => {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };

  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName.toUpperCase();
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) breakLine();
    for (const child of [...element.childNodes]) walk(child);
    if (block) breakLine();
  };

  for (const child of [...root.childNodes]) walk(child);

  // Закрывающая граница последнего блока — не набранный пользователем перенос.
  return out.replace(/\n$/u, '').replace(SPACE_SEPARATORS, ' ');
}

/** Приводит вставленный из буфера/дропа текст к тому, что можно положить в сообщение. */
export function normalizePastedText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(SPACE_SEPARATORS, ' ')
    .replace(CONTROL_CHARS, (char) => (char === '\n' ? char : ''));
}

export function isComposerBlank(text: string): boolean {
  return text.trim().length === 0;
}

export function clampComposerText(text: string, max: number = AI_COMPOSER_MAX_LENGTH): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** Сколько из `insert` реально влезет поверх уже набранного `current`. */
export function fitInsertion(current: string, insert: string, max: number = AI_COMPOSER_MAX_LENGTH): string {
  return insert.slice(0, Math.max(0, max - current.length));
}
