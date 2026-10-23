import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// Worker MCP receives a trusted root from the dispatcher. Standalone clients retain
// their existing temporary cache, but a worker must never write outside its project.
function checkedAttachmentPath(target: string): string {
  const workspace = process.env['PROJECTSFLOW_WORKSPACE_ROOT'];
  const path = resolve(workspace || process.cwd(), target);
  if (!workspace) return path;
  const root = realpathSync(workspace);
  const inside = (candidate: string): boolean => {
    const rel = relative(root, candidate);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!inside(path)) throw new Error('attachment_path_outside_workspace');
  if (relative(root, path).split(sep).some(part => part.toLowerCase() === '.git')) {
    throw new Error('attachment_git_metadata_write');
  }
  let parent = path;
  while (true) {
    try { lstatSync(parent); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = dirname(parent);
      if (next === parent) throw new Error('attachment_parent_missing');
      parent = next;
    }
  }
  const actual = realpathSync(parent);
  if (actual !== root && !inside(actual)) throw new Error('attachment_path_outside_workspace');
  return path;
}

function excludeWorkerCacheFromGit(): void {
  const workspace = process.env['PROJECTSFLOW_WORKSPACE_ROOT'];
  if (!workspace) return;
  const root = realpathSync(workspace);
  const cache = checkedAttachmentPath(attachmentsRoot());
  const git = join(root, '.git');
  if (!existsSync(git)) return; // Snapshot projects ignore node_modules themselves.
  const info = join(git, 'info'), exclude = join(info, 'exclude');
  for (const target of [git, info, exclude]) {
    try {
      if (lstatSync(target).isSymbolicLink()) throw new Error('attachment_git_exclude_indirection');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!lstatSync(git).isDirectory()) throw new Error('attachment_git_metadata_outside_workspace');
  mkdirSync(info, { recursive: true });
  const marker = `/${relative(root, cache).split(sep).join('/')}/`;
  const content = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!content.split(/\r?\n/).includes(marker)) appendFileSync(exclude, `\n${marker}\n`, 'utf8');
}

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
  const path = checkedAttachmentPath(attachmentPath(taskId, attachmentId, filename));
  excludeWorkerCacheFromGit();
  mkdirSync(join(path, '..'), { recursive: true });
  checkedAttachmentPath(path);
  writeFileSync(path, data);
  return path;
}

// Явный путь от юзера (saveTo у pf_read_task_attachment): относительный резолвим от cwd.
export function saveAttachmentTo(target: string, data: Buffer): string {
  const path = checkedAttachmentPath(target);
  mkdirSync(join(path, '..'), { recursive: true });
  checkedAttachmentPath(path);
  writeFileSync(path, data);
  return path;
}

export function pruneAttachmentCache(now = Date.now()): void {
  try {
    const root = checkedAttachmentPath(attachmentsRoot());
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const dir = checkedAttachmentPath(join(root, entry.name));
      try {
        if (lstatSync(dir).isSymbolicLink()) continue;
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
