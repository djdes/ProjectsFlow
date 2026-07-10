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
  Row,
  SelectOpts,
  WhereClause,
} from '../../application/app-backend/AppDatabaseStore.js';
import { AppTableNotAllowedError } from '../../domain/app-backend/errors.js';

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
    `);
    for (const t of schema.tables) {
      const cols = [
        'id TEXT PRIMARY KEY',
        'owner_id TEXT',
        'created_at TEXT NOT NULL',
        ...t.fields.map((f) => {
          const notnull = f.required ? ' NOT NULL' : '';
          const uniq = f.unique ? ' UNIQUE' : '';
          return `"${f.name}" ${SQLITE_TYPE[f.type]}${notnull}${uniq}`;
        }),
      ];
      conn.db.exec(`CREATE TABLE IF NOT EXISTS "${t.name}" (${cols.join(', ')});`);
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
    if (allowed.has('created_at') && !('created_at' in values)) {
      row.created_at = new Date().toISOString();
    }
    const finalCols = Object.keys(row);
    const quoted = finalCols.map((k) => `"${k}"`).join(', ');
    const placeholders = finalCols.map(() => '?').join(', ');
    const params = finalCols.map((k) => normalizeValue(row[k]));
    conn.db.prepare(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`).run(...params);
    if (hasId && typeof row.id === 'string') {
      return this.findOne(projectId, table, { id: row.id }) ?? row;
    }
    return row;
  }

  select(projectId: string, table: string, opts: SelectOpts = {}): Row[] {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const { clause, params } = buildWhere(allowed, opts.where);
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

  findOne(projectId: string, table: string, where: WhereClause): Row | null {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const { clause, params } = buildWhere(allowed, where);
    const row = conn.db.prepare(`SELECT * FROM "${table}"${clause} LIMIT 1`).get(...params);
    return (row as Row | undefined) ?? null;
  }

  update(projectId: string, table: string, id: string, values: Row): number {
    const conn = this.open(projectId);
    const allowed = this.allowedCols(conn, table);
    const keys = Object.keys(values).filter((k) => k !== 'id');
    this.assertCols(allowed, keys);
    if (keys.length === 0) return 0;
    const setSql = keys.map((k) => `"${k}" = ?`).join(', ');
    const params = keys.map((k) => normalizeValue(values[k]));
    const res = conn.db.prepare(`UPDATE "${table}" SET ${setSql} WHERE "id" = ?`).run(...params, id);
    return res.changes;
  }

  remove(projectId: string, table: string, id: string): number {
    const conn = this.open(projectId);
    this.allowedCols(conn, table);
    const res = conn.db.prepare(`DELETE FROM "${table}" WHERE "id" = ?`).run(id);
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
