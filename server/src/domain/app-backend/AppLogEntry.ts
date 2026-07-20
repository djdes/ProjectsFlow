// Единая запись ленты логов дашборда приложения (срез 2 плана dashboard-parity). Сводит в один
// тип разнородные источники: административный аудит Data Explorer (app_admin_audit_log) и рантайм-
// аудит (per-project SQLite `_audit_log`), действия воркера (live_sessions / task_progress_events),
// публикацию сайта и auth-события энд-юзеров приложения. НОВОЙ таблицы-агрегата нет — записи
// собираются на лету адаптерами над уже существующими таблицами (см. application/QueryAppLogs).

import { classifyField, tokenizeFieldName } from './sensitiveFields.js';

// Категория события — по образцу категорий Base44 (data / auth / worker / publish / runtime).
//  - data    — чтение/запись данных: Data Explorer админа и CRUD рантайма приложения;
//  - auth    — регистрация/вход/выход/приглашения энд-юзеров приложения;
//  - worker  — прогоны Ralph-воркера по задачам проекта (старт/финиш, статус, стоимость);
//  - publish — публикация статики сайта проекта;
//  - runtime — прочая рантайм-активность приложения (визиты страниц и т.п.).
export type AppLogCategory = 'data' | 'auth' | 'worker' | 'publish' | 'runtime';

export const APP_LOG_CATEGORIES: readonly AppLogCategory[] = [
  'data',
  'auth',
  'worker',
  'publish',
  'runtime',
];

export type AppLogActorType = 'runtime' | 'project_member' | 'system';

// Одно событие единой ленты. `id` глобально уникален в пределах ленты (источник добавляет
// собственный префикс, чтобы id из разных таблиц не сталкивались при слиянии). `createdAt` —
// ISO-8601 со миллисекундами (тот же формат, что пишут оба журнала аудита), по нему идёт
// курсорная пагинация. `detail` отдаётся клиенту ТОЛЬКО после sanitizeLogDetail.
export type AppLogEntry = {
  readonly id: string;
  readonly category: AppLogCategory;
  readonly actorType: AppLogActorType;
  readonly actorId: string | null;
  readonly operation: string;
  readonly tableName: string | null;
  readonly rowId: string | null;
  readonly success: boolean;
  readonly createdAt: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
};

// Категория для событий, пришедших из журналов аудита (административного и рантайм-): у них есть
// только строка `operation`. Источники worker/publish проставляют категорию сами, эту функцию не
// зовут. Порядок проверок важен: auth строже «visit»/data, иначе `app.user.registered` уедет в data.
export function categorizeAuditOperation(operation: string): AppLogCategory {
  const op = operation.toLowerCase();
  if (
    /(^|[._-])(sign_?up|sign_?in|sign_?out|signup|signin|signout|log_?in|log_?out|login|logout|register|registered|invite|invited)([._-]|$)/.test(
      op,
    ) ||
    op.includes('auth')
  ) {
    return 'auth';
  }
  if (op.includes('visit')) return 'runtime';
  if (
    op.startsWith('dashboard.') ||
    op.startsWith('app.entity') ||
    op === 'select' ||
    op === 'insert' ||
    op === 'update' ||
    op === 'delete'
  ) {
    return 'data';
  }
  return 'runtime';
}

// Маркер вычищенного значения. Не сообщает ни длину, ни форму исходной строки.
export const LOG_DETAIL_REDACTED = '[скрыто]';

// Ключи detail, чьи значения по смыслу могут нести куски промптов, путей, тел запросов или сырых
// значений строк. Проверяем по ТОКЕНАМ имени (tokenizeFieldName), чтобы `filePath` ловился так же,
// как `file_path`, а безопасный `filesystem_status` — нет (его токены — filesystem/status).
const VERBOSE_DETAIL_TOKENS = new Set([
  'prompt', 'prompts', 'content', 'text', 'body', 'message', 'msg',
  'path', 'paths', 'file', 'files', 'filename', 'filepath', 'dir', 'directory',
  'command', 'cmd', 'args', 'argv', 'arg', 'diff', 'patch', 'stdout', 'stderr',
  'output', 'snippet', 'code', 'sql', 'query', 'payload', 'response', 'request',
  'value', 'values', 'input', 'url', 'uri', 'endpoint', 'headers', 'header',
]);

// Строки, которые надо резать вне зависимости от имени ключа (значение само выглядит секретом
// или файловым путём — типичный «побочный канал» из detail воркера, см. раздел 4 плана).
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)_[A-Za-z0-9]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// Похоже на путь в ФС: unix-абсолютный из ≥2 сегментов, windows-путь с буквой диска, либо явные
// системные корни. Пути из detail воркера раскрывают структуру машины — режем.
const FS_PATH_PATTERN = /(?:^|[\s"'(=])(?:\/[\w.@+-]+){2,}\/?|[A-Za-z]:[\\/][\w.@+\\/-]+|(?:\/home\/|\/var\/|\/etc\/|\/root\/|\/Users\/)/;

const MAX_STRING_LEN = 300;
const MAX_DEPTH = 4;
const MAX_ARRAY_SCAN = 50;

function keyIsSensitive(key: string): boolean {
  if (classifyField(key)) return true; // переиспользуем классификатор секрет/PII по имени поля
  return tokenizeFieldName(key).some((token) => VERBOSE_DETAIL_TOKENS.has(token));
}

function scrubString(value: string): string {
  if (SECRET_VALUE_PATTERNS.some((re) => re.test(value))) return LOG_DETAIL_REDACTED;
  if (FS_PATH_PATTERN.test(value)) return LOG_DETAIL_REDACTED;
  if (value.length > MAX_STRING_LEN) return `${value.slice(0, MAX_STRING_LEN)}…[обрезано]`;
  return value;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return LOG_DETAIL_REDACTED;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_SCAN).map((item) => scrubValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return scrubRecord(value as Record<string, unknown>, depth + 1);
  }
  return LOG_DETAIL_REDACTED;
}

function scrubRecord(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = keyIsSensitive(key) ? LOG_DETAIL_REDACTED : scrubValue(value, depth);
  }
  return out;
}

// Единственная точка очистки detail перед отдачей клиенту. Защищает единую ленту от утечки через
// побочный канал: секретные значения по ключу (api_key, password…), verbose-поля с промптами/путями
// и строки, которые сами выглядят секретом/путём, заменяются на нейтральный маркер. Факт события
// (operation, table, column, kind, счётчики) остаётся — по нему нельзя восстановить скрытое значение.
export function sanitizeLogDetail(
  detail: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, unknown>> | null {
  if (!detail) return null;
  return scrubRecord(detail as Record<string, unknown>, 0);
}
