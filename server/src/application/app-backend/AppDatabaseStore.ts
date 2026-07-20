import type { AppSchema } from '../../domain/app-backend/AppSchema.js';

export type Row = Record<string, unknown>;
// Условие WHERE — набор равенств, соединённых AND (для MVP этого достаточно).
export type WhereClause = Readonly<Record<string, unknown>>;

export type AppFilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'starts_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty';

export type AppDataFilter = {
  readonly column: string;
  readonly operator: AppFilterOperator;
  readonly value?: unknown;
};

export type SelectOpts = {
  readonly where?: WhereClause;
  readonly filters?: readonly AppDataFilter[];
  readonly search?: { readonly columns: readonly string[]; readonly value: string };
  readonly orderBy?: { readonly column: string; readonly dir: 'asc' | 'desc' };
  readonly limit?: number;
  readonly offset?: number;
};

export type AppAuditInput = {
  readonly actorType: 'runtime' | 'project_member' | 'system';
  readonly actorId?: string | null;
  readonly operation: string;
  readonly tableName?: string | null;
  readonly rowId?: string | null;
  readonly success?: boolean;
  readonly detail?: Readonly<Record<string, unknown>> | null;
};

export type AppAuditEntry = AppAuditInput & {
  readonly id: string;
  readonly createdAt: string;
  readonly success: boolean;
};

export type AppAuditListOpts = {
  readonly tableName?: string;
  readonly operation?: string;
  readonly actorId?: string;
  readonly errorsOnly?: boolean;
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
  count(projectId: string, table: string, opts?: Omit<SelectOpts, 'orderBy' | 'limit' | 'offset'>): number;
  findOne(projectId: string, table: string, where: WhereClause): Row | null;
  // updated_at ставит стор автоматически. expectedUpdatedAt (optimistic concurrency, долг 0.1):
  // если передан — апдейт применяется, только когда версия строки совпадает; иначе меняется 0 строк.
  update(
    projectId: string,
    table: string,
    id: string,
    values: Row,
    expectedUpdatedAt?: string | null,
  ): number;
  remove(projectId: string, table: string, id: string): number;
  // Удаление по произвольному равенству (напр. сессии по token_hash). Пустой where → 0 (никогда
  // не удаляем всю таблицу).
  removeWhere(projectId: string, table: string, where: WhereClause): number;
  recordAudit(projectId: string, input: AppAuditInput): AppAuditEntry;
  listAudit(projectId: string, opts?: AppAuditListOpts): { rows: AppAuditEntry[]; total: number };
}
