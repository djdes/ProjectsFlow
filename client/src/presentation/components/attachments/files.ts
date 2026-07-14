// Общие хелперы для вложений (доска, Входящие, комментарии). Любой тип файла разрешён —
// фильтрация по MIME убрана; ограничение размера валидирует сервер.

export function isImageMime(mime: string): boolean {
  // SVG отдаётся сервером как download (анти-XSS), поэтому inline-превью не делаем.
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

// Растровые расширения — фолбэк, когда MIME пустой/кривой (часто у .webp и файлов из
// мессенджеров). Тогда определяем картинку по имени и всё равно показываем превью.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'jfif', 'apng'];

// Картинка ли это — по MIME ИЛИ по расширению имени файла. Используется для рендера
// <img>-превью (чипы вложений, лайтбокс) и зеркалится на сервере (inline-отдача).
export function isImageFile(mime: string | null | undefined, filename?: string | null): boolean {
  if (mime === 'image/svg+xml') return false; // svg всегда download (анти-XSS)
  if (mime && mime.startsWith('image/')) return true;
  const ext = (filename ?? '').split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS.includes(ext);
}

// Извлекает ВСЕ файлы из буфера обмена (любой тип, не только картинки). Возвращает []
// если файлов нет — тогда caller не делает preventDefault (обычная вставка текста).
export function extractClipboardFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (file: File): void => {
    const key = `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (let i = 0; i < clipboardData.items.length; i += 1) {
    const it = clipboardData.items[i];
    if (it && it.kind === 'file') {
      const file = it.getAsFile();
      if (file) add(file);
    }
  }
  // Windows Snipping Tool, некоторые браузеры и Electron-приложения кладут скрин только
  // в DataTransfer.files. Раньше такой Ctrl+V молча терялся. Объединяем оба источника и
  // дедуплицируем: в Chrome один и тот же File часто присутствует одновременно в обоих.
  for (let i = 0; i < clipboardData.files.length; i += 1) {
    const file = clipboardData.files[i];
    if (file) add(file);
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}
