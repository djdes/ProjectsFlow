import type { AppSchema } from '../../domain/app-backend/AppSchema.js';

export type Row = Record<string, unknown>;
// Условие WHERE — набор равенств, соединённых AND (для MVP этого достаточно).
export type WhereClause = Readonly<Record<string, unknown>>;

export type SelectOpts = {
  readonly where?: WhereClause;
  readonly orderBy?: { readonly column: string; readonly dir: 'asc' | 'desc' };
  readonly limit?: number;
  readonly offset?: number;
};

// Порт стора per-project баз (SQLite-файл на проект). Имена таблиц/полей приходят УЖЕ
// провалидированными (из AppSchema или системные `_*`); стор дополнительно сверяет их с фактической
// схемой файла (белый список колонок) и биндит ТОЛЬКО значения (защита от инъекций).
export interface AppDatabaseStore {
  // Создать/догнать файл-базу проекта: системные таблицы (_users/_sessions/_meta) + таблицы схемы.
  // Идемпотентно.
  ensureDatabase(projectId: string, schema: AppSchema): void;
  // Текущий размер файла-базы (вместе с WAL) в байтах — для учёта квоты.
  sizeBytes(projectId: string): number;
  insert(projectId: string, table: string, values: Row): Row;
  select(projectId: string, table: string, opts?: SelectOpts): Row[];
  findOne(projectId: string, table: string, where: WhereClause): Row | null;
  update(projectId: string, table: string, id: string, values: Row): number;
  remove(projectId: string, table: string, id: string): number;
  // Удаление по произвольному равенству (напр. сессии по token_hash). Пустой where → 0 (никогда
  // не удаляем всю таблицу).
  removeWhere(projectId: string, table: string, where: WhereClause): number;
}
