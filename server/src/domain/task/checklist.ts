// GFM-чеклисты (`- [ ]` / `- [x]`) в markdown-описании задачи.
// Тот же разбор, что у клиента (client/src/lib/checklist.ts): строки внутри fenced-блоков
// кода (```) не чекбоксы — GFM их не рендерит, и трогать их нельзя.

const CHECKBOX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[(?:x|X)\]/u;
const FENCE_RE = /^\s*(```|~~~)/u;

/** Снять все отметки чеклиста: следующий повтор задачи начинается с чистого списка. */
export function resetChecklist(description: string): string {
  let inFence = false;
  return description
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : line.replace(CHECKBOX_RE, '$1[ ]');
    })
    .join('\n');
}
