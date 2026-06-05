// Запись текста в буфер обмена, когда источник текста — сетевой запрос.
//
// Проблема: после `await fetch(...)` теряется «user activation», и Safari/Firefox
// отклоняют navigator.clipboard.writeText. Решение — `ClipboardItem` с promise-значением:
// write() вызывается синхронно в обработчике клика, а Blob резолвится позже.
//
// `produce` — УЖЕ запущенный Promise<string> (fetch стартует синхронно в onClick).
export async function copyTextFromPromise(produce: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && 'write' in navigator.clipboard) {
    try {
      const blob = produce.then((t) => new Blob([t], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch {
      // Старые/строгие браузеры — деградируем на writeText ниже (тот же promise,
      // повторного запроса не будет).
    }
  }
  const text = await produce;
  await navigator.clipboard.writeText(text);
}

// Rich-копирование: кладём в буфер ОБА флейвора — text/html (его читает Telegram при вставке
// и применяет вёрстку) и text/plain (фолбэк-markdown для обычных полей). Текст уже в памяти
// (значение textarea), поэтому промис-трюк не нужен — но ClipboardItem всё равно строим
// синхронно в обработчике клика, чтобы сохранить user-activation (требование Safari).
export async function copyRich(html: string, plain: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && 'write' in navigator.clipboard) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Старые/строгие браузеры (или нет html-флейвора) — деградируем на plain markdown.
    }
  }
  await navigator.clipboard.writeText(plain);
}
