import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

// ============================================================
// Материализация вложений задачи на диск.
//
// Зачем: MCP-ответ может нести файл тремя способами — `text`, `image` и embedded
// `resource` (blob). Блоки `image`/`resource` понимают ДАЛЕКО не все клиенты: Claude Code
// их разворачивает, а Codex / Cursor / Gemini CLI и прочие чаще всего молча выкидывают
// всё, кроме текста. Для них задача с приложенным скрином/PDF/голосовым выглядела как
// голая метадата — «файл вижу в списке, а открыть не могу».
//
// Универсальный канал, который есть у ЛЮБОГО кодового агента, — файл на диске плюс путь
// к нему в тексте. Поэтому вложения пишем во временный каталог и отдаём абсолютный
// `localPath`; блоки `image` оставляем сверху как бонус для клиентов, которые их умеют.
// ============================================================

// Каталог кэша можно переопределить (например, положить рядом с рабочим репо воркера).
export function attachmentsRoot(): string {
  const override = process.env['PROJECTSFLOW_ATTACHMENT_DIR'];
  if (override && override.trim().length > 0) return resolve(override.trim());
  return join(tmpdir(), 'projectsflow-mcp', 'attachments');
}

// Файлы копятся между сессиями и сами не чистятся — подметаем всё старше недели при
// каждой записи. Дешевле, чем отдельный демон, и не даёт кэшу расти бесконечно.
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Windows запрещает < > : " / \ | ? *, плюс режем управляющие символы и точки по краям.
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const safe = cleaned.length > 0 ? cleaned : 'attachment.bin';
  // 120 символов с запасом влезают в лимит пути даже с длинным tmpdir.
  return safe.length > 120 ? safe.slice(safe.length - 120) : safe;
}

// Путь вида <root>/<taskId>/<attachmentId-8>-<filename>. Префикс из id разводит
// одноимённые файлы (два `screenshot.png` в одной задаче — обычное дело).
export function attachmentPath(taskId: string, attachmentId: string, filename: string): string {
  const prefix = attachmentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'att';
  return join(attachmentsRoot(), sanitizeFilename(taskId), `${prefix}-${sanitizeFilename(filename)}`);
}

// Пишем байты и возвращаем абсолютный путь. Перезапись идемпотентна: повторный
// pf_get_task просто обновит тот же файл.
export function saveAttachment(
  taskId: string,
  attachmentId: string,
  filename: string,
  data: Buffer,
): string {
  const path = attachmentPath(taskId, attachmentId, filename);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, data);
  return path;
}

// Явный путь от юзера (saveTo у pf_read_task_attachment): относительный резолвим от cwd.
export function saveAttachmentTo(target: string, data: Buffer): string {
  const path = isAbsolute(target) ? target : resolve(process.cwd(), target);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, data);
  return path;
}

export function pruneAttachmentCache(now = Date.now()): void {
  try {
    const root = attachmentsRoot();
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const dir = join(root, entry.name);
      try {
        if (now - statSync(dir).mtimeMs > MAX_CACHE_AGE_MS) rmSync(dir, { recursive: true, force: true });
      } catch {
        // Гонка с другим процессом / занятый файл — пропускаем, это лишь уборка.
      }
    }
  } catch {
    // Каталога ещё нет — чистить нечего.
  }
}

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/typescript',
  'application/sql',
  'application/x-sh',
  'application/x-httpd-php',
  'image/svg+xml',
]);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'jsonl', 'yml', 'yaml', 'xml', 'html',
  'htm', 'css', 'scss', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'cs', 'c', 'h', 'cpp', 'hpp', 'php', 'sh', 'ps1', 'bat', 'sql', 'ini', 'conf', 'env',
  'toml', 'svg', 'diff', 'patch',
]);

// Текстовые файлы инлайним прямо в ответ — это единственный формат, который видит
// вообще любой клиент, и агенту не приходится делать лишний Read.
export function isTextLike(mimeType: string, filename: string): boolean {
  const mime = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  if (TEXT_MIME_EXACT.has(mime)) return true;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.has(ext);
}

// 64 KB текста — потолок инлайна: дальше начинает вытеснять полезный контекст, а полный
// файл всё равно лежит на диске по localPath.
const MAX_INLINE_TEXT_BYTES = 64 * 1024;

export function decodeTextPreview(data: Buffer): { text: string; truncated: boolean } {
  const truncated = data.byteLength > MAX_INLINE_TEXT_BYTES;
  const slice = truncated ? data.subarray(0, MAX_INLINE_TEXT_BYTES) : data;
  return { text: slice.toString('utf8'), truncated };
}

export function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
