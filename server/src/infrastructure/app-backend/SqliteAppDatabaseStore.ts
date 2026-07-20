import type DatabaseNS from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// better-sqlite3 — НАТИВНЫЙ модуль. Грузим ЛЕНИВО (createRequire), а не статическим import:
// если на сервере не встал/несовместим prebuilt-бинарник, падает только app-backend (5xx на его
// эндпоинтах), а не весь сервер при загрузке (иначе pm2 крутил бы crash-loop → 502 на всю платформу).
type SqliteCtor = typeof import('better-sqlite3');
const requireCjs = createRequire(import.meta.url);
let ctorCache: SqliteCtor | undefined;
function sqliteCtor(): SqliteCtor {
  if (!ctorCache) ctorCache = requireCjs('better-sqlite3') as SqliteCtor;
  return ctorCache;
}
import type { AppFieldType, AppSchema } from '../../domain/app-backend/AppSchema.js';
import type {
  AppDatabaseStore,
  AppAuditEntry,
  AppAuditInput,
  AppAuditListOpts,
  AppDataFilter,
  Row,
  SelectOpts,
  WhereClause,
} from '../../application/app-backend/AppDatabaseStore.js';
import { AppTableNotAllowedError, AppUniqueViolationError } from '../../domain/app-backend/errors.js';

// projectId используется для построения пути к файлу → жёсткая проверка формата (защита от traversal).
const PROJECT_ID_RE = /^[a-z0-9-]{6,64}$/i;

const SQLITE_TYPE: Record<AppFieldType, string> = {
  text: 'TEXT',
  int: 'INTEGER',
  real: 'REAL',
  bool: 'INTEGER',
  datetime: 'TEXT',
};

type Conn = {
  db: DatabaseNS.Database;
  // table → множество допустимых имён колонок (белый список идентификаторов).
  columns: Map<string, Set<string>>;
};

// better-sqlite3 биндит только number/string/bigint/buffer/null → нормализуем bool/undefined/объекты.
function normalizeValue(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

// Монотонные метки времени: created_at/updated_at строго возрастают между записями в рамках процесса.
// Нужно для optimistic concurrency (долг 0.1) — две записи в одну миллисекунду не должны получить
// одинаковую версию, иначе устаревший апдейт прошёл бы как совпадающий по updated_at.
let lastTsMillis = 0;
function nowIso(): string {
  let t = Date.now();
  if (t <= lastTsMillis) t = lastTsMillis + 1;
  lastTsMillis = t;
  return new Date(t).toISOString();
}

// Реализация AppDatabaseStore на SQLite: один файл на проект, кэш соединений, параметризованные CRUD.
export class SqliteAppDatabaseStore implements AppDatabaseStore {
  private readonly conns = new Map<string, Conn>();

  constructor(
    private readonly baseDir: string,
    private readonly idGen: () => string = randomUUID,
  ) {
    mkdirSync(baseDir, { recursive: true });
  }

  private filePath(projectId: string): string {
    if (!PROJECT_ID_RE.test(projectId)) throw new Error(`invalid projectId: ${projectId}`);
    return join(this.baseDir, `${projectId}.sqlite`);
  }

  private open(projectId: string): Conn {
    const existing = this.conns.get(projectId);
    if (existing) return existing;
    const db = new (sqliteCtor())(this.filePath(projectId));
    db.pragma('journal_mode = WAL');
    const conn: Conn = { db, columns: new Map() };
    this.conns.set(projectId, conn);
    this.reloadColumns(conn);
    return conn;
  }

  private reloadColumns(conn: Conn): void {
    conn.columns.clear();
    const tables = conn.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      const cols = conn.db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[];
      conn.columns.set(name, new Set(cols.map((x) => x.name)));
    }
  }

  ensureDatabase(projectId: string, schema: AppSchema): void {
    const conn = this.open(projectId);
    conn.db.exec(`
      CREATE TABLE IF NOT EXISTS _users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS _audit_log (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        operation TEXT NOT NULL,
        table_name TEXT,
        row_id TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON _audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_table ON _audit_log(table_name, created_at DESC);
    `);
    for (const t of schema.tables) {
      const cols = [
        'id TEXT PRIMARY KEY',
        'owner_id TEXT',
        'created_at TEXT NOT NULL',
        'updated_at TEXT',
        'deleted_at TEXT',
        ...t.fields.map((f) => {
          const notnull = f.required ? ' NOT NULL' : '';
          const uniq = f.unique ? ' UNIQUE' : '';
          return `"${f.name}" ${SQLITE_TYPE[f.type]}${notnull}${uniq}`;
        }),
      ];
      conn.db.exec(`CREATE TABLE IF NOT EXISTS "${t.name}" (${cols.join(', ')});`);
      // Обратная совместимость: уже созданные (до долга 0.1) базы не имеют updated_at. Догоняем
      // идемпотентно — ADD COLUMN на существующей таблице. NULL в старых строках допустим: до первой
      // записи версия строки «неизвестна», клиент шлёт запрос без проверки версии (last-write-wins).
      // Аналогично deleted_at (soft-delete, срез 5): NULL = строка «живая»; ставится при remove,
      // сбрасывается restore. Только у таблиц СХЕМЫ — системные `_*` удаляются жёстко (hard delete).
      const existing = conn.db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[];
      if (!existing.some((c) => c.name === 'updated_at')) {
        conn.db.exec(`ALTER TABLE "${t.name}" ADD COLUMN updated_at TEXT`);
      }
      if (!existing.some((c) => c.name === 'deleted_at')) {
        conn.db.exec(`ALTER TABLE "${t.name}" ADD COLUMN deleted_at TEXT`);
      }
    }
    this.reloadColumns(conn);
  }

  sizeBytes(projectId: string): number {
    const p = this.filePath(projectId);
    if (!existsSync(p)) return 0;
    let total = statSync(p).size;
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(p + suffix)) total += statSync(p + suffix).size;
    }
    return total;
  }

  private allowedCols(conn: Conn, table: string): Set<string> {
    const cols = conn.columns.get(table);
    if (!cols) throw new AppTableNotAllowedError(table);
    return cols;
  }

  private assertCols(allowed: Set<string>, names: Iterable<string>): void {
    for (const n of names) {
      if (!allowed.has(n)) throw new AppTableNotAllowedError(`column ${n}`);
    }
  }

  insert(projectId: string, table: string, values: Row): Row {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const givenKeys = Object.keys(values);
    this.assertCols(allowed, givenKeys);

    const row: Row = { ...values };
    // id/created_at добавляем ТОЛЬКО если у таблицы есть такие колонки (у `_sessions` id нет).
    const hasId = allowed.has('id');
    if (hasId && !(typeof values.id === 'string' && values.id)) {
      row.id = this.idGen();
    }
    const ts = nowIso();
    if (allowed.has('created_at') && !('created_at' in values)) {
      row.created_at = ts;
    }
    // updated_at = created_at при вставке: строка «свежая», её версия совпадает с моментом создания.
    if (allowed.has('updated_at') && !('updated_at' in values)) {
      row.updated_at = row.created_at ?? ts;
    }
    const finalCols = Object.keys(row);
    const quoted = finalCols.map((k) => `"${k}"`).join(', ');
    const placeholders = finalCols.map(() => '?').join(', ');
    const params = finalCols.map((k) => normalizeValue(row[k]));
    try {
      conn.db.prepare(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`).run(...params);
    } catch (error) {
      // Нарушение UNIQUE поднимаем типизированной доменной ошибкой (а не сырым SqliteError), чтобы
      // прикладной слой мог ответить нейтрально по чувствительной колонке и не раскрывать её имя.
      const columns = parseUniqueViolation(error);
      if (columns) throw new AppUniqueViolationError(table, columns);
      throw error;
    }
    if (hasId && typeof row.id === 'string') {
      return this.findOne(projectId, table, { id: row.id }) ?? row;
    }
    return row;
  }

  select(projectId: string, table: string, opts: SelectOpts = {}): Row[] {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const excludeDeleted = allowed.has('deleted_at') && !opts.includeDeleted;
    const { clause, params } = buildPredicate(allowed, opts.where, opts.filters, opts.search, excludeDeleted);
    let sql = `SELECT * FROM "${table}"${clause}`;
    if (opts.orderBy) {
      if (!allowed.has(opts.orderBy.column)) {
        throw new AppTableNotAllowedError(`column ${opts.orderBy.column}`);
      }
      sql += ` ORDER BY "${opts.orderBy.column}" ${opts.orderBy.dir === 'desc' ? 'DESC' : 'ASC'}`;
    }
    sql += ` LIMIT ${clampInt(opts.limit, 1, 1000, 100)}`;
    if (opts.offset && opts.offset > 0) sql += ` OFFSET ${Math.floor(opts.offset)}`;
    return conn.db.prepare(sql).all(...params) as Row[];
  }

  count(
    projectId: string,
    table: string,
    opts: Omit<SelectOpts, 'orderBy' | 'limit' | 'offset'> = {},
  ): number {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const excludeDeleted = allowed.has('deleted_at') && !opts.includeDeleted;
    const { clause, params } = buildPredicate(allowed, opts.where, opts.filters, opts.search, excludeDeleted);
    const row = conn.db
      .prepare(`SELECT COUNT(*) AS total FROM "${table}"${clause}`)
      .get(...params) as { total: number | bigint };
    return Number(row.total);
  }

  findOne(projectId: string, table: string, where: WhereClause): Row | null {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const { clause, params } = buildWhere(allowed, where);
    const row = conn.db.prepare(`SELECT * FROM "${table}"${clause} LIMIT 1`).get(...params);
    return (row as Row | undefined) ?? null;
  }

  // updated_at ведётся стором, не клиентом: любой update строки бампает версию. Если передан
  // expectedUpdatedAt — WHERE дополняется проверкой версии (optimistic concurrency, долг 0.1):
  // при несовпадении меняется 0 строк, и вызывающий отличает конфликт от «строки нет».
  update(
    projectId: string,
    table: string,
    id: string,
    values: Row,
    expectedUpdatedAt?: string | null,
  ): number {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    // created_at/updated_at неизменяемы клиентом: created_at фиксирован, updated_at ставит стор.
    const keys = Object.keys(values).filter((k) => k !== 'id' && k !== 'created_at' && k !== 'updated_at');
    this.assertCols(allowed, keys);
    const hasUpdatedAt = allowed.has('updated_at');
    const setParts = keys.map((k) => `"${k}" = ?`);
    const params = keys.map((k) => normalizeValue(values[k]));
    if (hasUpdatedAt) {
      setParts.push('"updated_at" = ?');
      params.push(nowIso());
    }
    if (setParts.length === 0) return 0;
    let sql = `UPDATE "${table}" SET ${setParts.join(', ')} WHERE "id" = ?`;
    const whereParams: unknown[] = [id];
    // `IS` — NULL-безопасное сравнение: старые строки с updated_at = NULL матчатся только запросом
    // без проверки версии (expectedUpdatedAt не передан вовсе).
    if (expectedUpdatedAt !== undefined && hasUpdatedAt) {
      sql += ' AND "updated_at" IS ?';
      whereParams.push(expectedUpdatedAt);
    }
    const res = conn.db.prepare(sql).run(...params, ...whereParams);
    return res.changes;
  }

  // Удаление: у таблиц схемы (есть колонка deleted_at) — МЯГКОЕ (проставляем метку, строку можно
  // вернуть через restore, срез 5). У системных `_*` без deleted_at — жёсткое DELETE. Повторное
  // удаление уже удалённой строки меняет 0 строк (WHERE deleted_at IS NULL).
  remove(projectId: string, table: string, id: string): number {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    if (allowed.has('deleted_at')) {
      const res = conn.db
        .prepare(`UPDATE "${table}" SET "deleted_at" = ? WHERE "id" = ? AND "deleted_at" IS NULL`)
        .run(nowIso(), id);
      return res.changes;
    }
    const res = conn.db.prepare(`DELETE FROM "${table}" WHERE "id" = ?`).run(id);
    return res.changes;
  }

  // Восстановление мягко удалённой строки (срез 5). Работает только по таблицам схемы с deleted_at;
  // сбрасывает метку, если строка была удалена. Возвращает число возвращённых строк (0 или 1).
  restore(projectId: string, table: string, id: string): number {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    if (!allowed.has('deleted_at')) return 0;
    const res = conn.db
      .prepare(`UPDATE "${table}" SET "deleted_at" = NULL WHERE "id" = ? AND "deleted_at" IS NOT NULL`)
      .run(id);
    return res.changes;
  }

  removeWhere(projectId: string, table: string, where: WhereClause): number {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const { clause, params } = buildWhere(allowed, where);
    if (!clause) return 0; // без WHERE не удаляем всю таблицу
    const res = conn.db.prepare(`DELETE FROM "${table}"${clause}`).run(...params);
    return res.changes;
  }

  recordAudit(projectId: string, input: AppAuditInput): AppAuditEntry {
    const conn = this.open(projectId);
    // Старые базы могли быть созданы до появления журнала. Идемпотентно догоняем системную
    // таблицу без знания пользовательской схемы.
    ensureAuditTable(conn);
    const entry: AppAuditEntry = {
      id: this.idGen(),
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      operation: input.operation.slice(0, 80),
      tableName: input.tableName ?? null,
      rowId: input.rowId ?? null,
      success: input.success !== false,
      detail: input.detail ?? null,
      createdAt: new Date().toISOString(),
    };
    conn.db.prepare(`
      INSERT INTO _audit_log
        (id, actor_type, actor_id, operation, table_name, row_id, success, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.actorType,
      entry.actorId,
      entry.operation,
      entry.tableName,
      entry.rowId,
      entry.success ? 1 : 0,
      entry.detail ? JSON.stringify(entry.detail) : null,
      entry.createdAt,
    );
    // Журнал нужен для диагностики, а не как бесконечное хранилище. Храним последние 2000
    // событий проекта, чтобы технические GET-запросы приложения не съели квоту.
    conn.db.prepare(`
      DELETE FROM _audit_log
      WHERE id IN (
        SELECT id FROM _audit_log ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 2000
      )
    `).run();
    return entry;
  }

  listAudit(
    projectId: string,
    opts: AppAuditListOpts = {},
  ): { rows: AppAuditEntry[]; total: number } {
    const conn = this.open(projectId);
    ensureAuditTable(conn);
    const parts: string[] = [];
    const params: unknown[] = [];
    if (opts.tableName) {
      parts.push('table_name = ?');
      params.push(opts.tableName);
    }
    if (opts.operation) {
      parts.push('operation = ?');
      params.push(opts.operation);
    }
    if (opts.actorId) {
      parts.push('actor_id = ?');
      params.push(opts.actorId);
    }
    if (opts.errorsOnly) parts.push('success = 0');
    const where = parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '';
    const totalRow = conn.db
      .prepare(`SELECT COUNT(*) AS total FROM _audit_log${where}`)
      .get(...params) as { total: number | bigint };
    // Потолок 2000 совпадает с размером самого буфера: listLogs тянет отсюда окно (offset+limit)
    // для слияния с надёжным журналом, и должен уметь достать все рантайм-события буфера.
    const limit = clampInt(opts.limit, 1, 2000, 100);
    const offset = clampInt(opts.offset, 0, 1_000_000, 0);
    const raw = conn.db.prepare(`
      SELECT id, actor_type, actor_id, operation, table_name, row_id, success, detail_json, created_at
      FROM _audit_log${where}
      ORDER BY created_at DESC, rowid DESC
      LIMIT ${limit} OFFSET ${offset}
    `).all(...params) as Array<{
      id: string;
      actor_type: AppAuditEntry['actorType'];
      actor_id: string | null;
      operation: string;
      table_name: string | null;
      row_id: string | null;
      success: number;
      detail_json: string | null;
      created_at: string;
    }>;
    return {
      total: Number(totalRow.total),
      rows: raw.map((row) => ({
        id: row.id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        operation: row.operation,
        tableName: row.table_name,
        rowId: row.row_id,
        success: row.success === 1,
        detail: parseAuditDetail(row.detail_json),
        createdAt: row.created_at,
      })),
    };
  }
}

// better-sqlite3 бросает SqliteError с code='SQLITE_CONSTRAINT_UNIQUE' и message вида
// "UNIQUE constraint failed: table.col1, table.col2". Возвращаем список задетых колонок (без
// префикса таблицы) или null, если это не UNIQUE-нарушение.
function parseUniqueViolation(error: unknown): string[] | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (code !== 'SQLITE_CONSTRAINT_UNIQUE') return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return [];
  const marker = 'failed:';
  const idx = message.indexOf(marker);
  if (idx < 0) return [];
  return message
    .slice(idx + marker.length)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((qualified) => {
      const dot = qualified.lastIndexOf('.');
      return dot >= 0 ? qualified.slice(dot + 1) : qualified;
    });
}

function ensureAuditTable(conn: Conn): void {
  conn.db.exec(`
    CREATE TABLE IF NOT EXISTS _audit_log (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      operation TEXT NOT NULL,
      table_name TEXT,
      row_id TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON _audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_table ON _audit_log(table_name, created_at DESC);
  `);
  if (!conn.columns.has('_audit_log')) {
    const cols = conn.db.prepare('PRAGMA table_info("_audit_log")').all() as { name: string }[];
    conn.columns.set('_audit_log', new Set(cols.map((column) => column.name)));
  }
}

function parseAuditDetail(raw: string | null): Readonly<Record<string, unknown>> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Readonly<Record<string, unknown>>
      : null;
  } catch {
    return null;
  }
}

function buildWhere(
  allowed: Set<string>,
  where?: WhereClause,
): { clause: string; params: unknown[] } {
  if (!where) return { clause: '', params: [] };
  const keys = Object.keys(where);
  if (keys.length === 0) return { clause: '', params: [] };
  for (const k of keys) {
    if (!allowed.has(k)) throw new AppTableNotAllowedError(`column ${k}`);
  }
  const clause = ' WHERE ' + keys.map((k) => `"${k}" = ?`).join(' AND ');
  return { clause, params: keys.map((k) => normalizeValue(where[k])) };
}

function escapeLike(value: unknown): string {
  return String(value ?? '').replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildPredicate(
  allowed: Set<string>,
  where?: WhereClause,
  filters?: readonly AppDataFilter[],
  search?: SelectOpts['search'],
  excludeDeleted = false,
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  // Мягко удалённые строки (deleted_at IS NOT NULL) по умолчанию не попадают в выборку/счётчик.
  if (excludeDeleted) parts.push('"deleted_at" IS NULL');
  if (where) {
    for (const [column, value] of Object.entries(where)) {
      if (!allowed.has(column)) throw new AppTableNotAllowedError(`column ${column}`);
      if (value === null) {
        parts.push(`"${column}" IS NULL`);
      } else {
        parts.push(`"${column}" = ?`);
        params.push(normalizeValue(value));
      }
    }
  }
  for (const filter of filters ?? []) {
    if (!allowed.has(filter.column)) {
      throw new AppTableNotAllowedError(`column ${filter.column}`);
    }
    const column = `"${filter.column}"`;
    switch (filter.operator) {
      case 'eq':
        if (filter.value === null) parts.push(`${column} IS NULL`);
        else { parts.push(`${column} = ?`); params.push(normalizeValue(filter.value)); }
        break;
      case 'neq':
        if (filter.value === null) parts.push(`${column} IS NOT NULL`);
        else { parts.push(`${column} != ?`); params.push(normalizeValue(filter.value)); }
        break;
      case 'contains':
        parts.push(`CAST(${column} AS TEXT) LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(filter.value)}%`);
        break;
      case 'starts_with':
        parts.push(`CAST(${column} AS TEXT) LIKE ? ESCAPE '\\'`);
        params.push(`${escapeLike(filter.value)}%`);
        break;
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const sqlOp = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.operator];
        parts.push(`${column} ${sqlOp} ?`);
        params.push(normalizeValue(filter.value));
        break;
      }
      case 'is_empty':
        parts.push(`(${column} IS NULL OR CAST(${column} AS TEXT) = '')`);
        break;
      case 'is_not_empty':
        parts.push(`(${column} IS NOT NULL AND CAST(${column} AS TEXT) != '')`);
        break;
    }
  }
  if (search?.value.trim()) {
    const columns = search.columns.filter((column) => allowed.has(column));
    if (columns.length > 0) {
      const needle = `%${escapeLike(search.value.trim())}%`;
      parts.push(`(${columns.map((column) => `CAST("${column}" AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      params.push(...columns.map(() => needle));
    }
  }
  return { clause: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '', params };
}
