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
