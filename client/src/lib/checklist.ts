// Утилиты GFM-чеклистов (`- [ ]` / `- [x]`) в markdown-тексте.
// Порядок чекбоксов = порядок строк в исходнике = порядок рендера ReactMarkdown,
// поэтому N-й чекбокс в DOM однозначно мапится на N-ю checkbox-строку источника.
// Строки внутри fenced-код-блоков (```) пропускаются — GFM их тоже не рендерит.

const CHECKBOX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;
const FENCE_RE = /^\s*(```|~~~)/;

function* checkboxLines(lines: readonly string[]): Generator<number> {
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && CHECKBOX_RE.test(line)) yield i;
  }
}

// Переключить состояние index-го (по порядку появления) чекбокса. Возвращает новый
// текст; если такого чекбокса нет — исходник без изменений.
export function toggleChecklistItem(src: string, index: number, checked: boolean): string {
  const lines = src.split('\n');
  let n = -1;
  for (const lineIdx of checkboxLines(lines)) {
    n += 1;
    if (n !== index) continue;
    lines[lineIdx] = (lines[lineIdx] ?? '').replace(CHECKBOX_RE, `$1[${checked ? 'x' : ' '}]`);
    return lines.join('\n');
  }
  return src;
}

// Прогресс чеклиста: {done, total} или null, если чекбоксов нет.
export function checklistProgress(src: string): { done: number; total: number } | null {
  const lines = src.split('\n');
  let done = 0;
  let total = 0;
  for (const lineIdx of checkboxLines(lines)) {
    total += 1;
    const m = CHECKBOX_RE.exec(lines[lineIdx] ?? '');
    if (m && m[2] !== ' ') done += 1;
  }
  return total > 0 ? { done, total } : null;
}
