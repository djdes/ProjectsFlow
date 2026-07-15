// Общие хелперы для вложений (доска, Входящие, комментарии). Любой тип файла разрешён —
// фильтрация по MIME убрана; ограничение размера валидирует сервер.

export function isImageMime(mime: string): boolean {
  // SVG отдаётся сервером как download (анти-XSS), поэтому inline-превью не делаем.
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

// Растровые расширения — фолбэк, когда MIME пустой/кривой (часто у .webp и файлов из
// мессенджеров). Тогда определяем картинку по имени и всё равно показываем превью.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'jfif', 'apng'];

const DATA_IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/apng': 'apng',
};

function fileFromImageDataUrl(dataUrl: string, index: number): File | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const meta = dataUrl.slice(5, comma);
  const mime = meta.split(';', 1)[0]?.toLowerCase() ?? '';
  const ext = DATA_IMAGE_EXT_BY_MIME[mime];
  if (!ext) return null;

  try {
    const payload = dataUrl.slice(comma + 1);
    let bytes: Uint8Array;
    if (/(?:^|;)base64(?:;|$)/i.test(meta)) {
      const binary = atob(payload.replace(/\s/g, ''));
      bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new File([buffer], `pasted-image-${index + 1}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

// Some Windows/Electron applications put a pasted screenshot into text/html as a data URL,
// without exposing it through DataTransfer.items/files. Convert that representation to a real
// File so it follows the exact same upload path as a regular clipboard image.
function extractDataUrlImages(clipboardData: DataTransfer): File[] {
  const urls: string[] = [];
  try {
    const html = clipboardData.getData('text/html');
    const srcRe = /\bsrc\s*=\s*(["'])(data:image\/[^"']+)\1/gi;
    let match: RegExpExecArray | null;
    while ((match = srcRe.exec(html)) !== null) {
      if (match[2]) urls.push(match[2].replace(/&amp;/g, '&'));
    }
    const plain = clipboardData.getData('text/plain').trim();
    if (plain.startsWith('data:image/')) urls.push(plain);
  } catch {
    // A clipboard implementation may throw for an unsupported flavour. Binary items still work.
  }
  return urls.flatMap((url, index) => {
    const file = fileFromImageDataUrl(url, index);
    return file ? [file] : [];
  });
}

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
  // Do not duplicate a normal binary clipboard image. This is a fallback for clipboard providers
  // that expose only an HTML/data-URL representation.
  if (out.length === 0) {
    for (const file of extractDataUrlImages(clipboardData)) add(file);
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}
