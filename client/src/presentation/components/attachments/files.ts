// Общие хелперы для вложений (доска, Входящие, комментарии). Любой тип файла разрешён —
// фильтрация по MIME убрана; ограничение размера валидирует сервер.

export function isImageMime(mime: string): boolean {
  // SVG отдаётся сервером как download (анти-XSS), поэтому inline-превью не делаем.
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

// Извлекает ВСЕ файлы из буфера обмена (любой тип, не только картинки). Возвращает []
// если файлов нет — тогда caller не делает preventDefault (обычная вставка текста).
export function extractClipboardFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const out: File[] = [];
  for (let i = 0; i < clipboardData.items.length; i += 1) {
    const it = clipboardData.items[i];
    if (it && it.kind === 'file') {
      const file = it.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}
