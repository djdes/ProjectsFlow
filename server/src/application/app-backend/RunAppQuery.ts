import type { AppBackendRepository } from './AppBackendRepository.js';
import type { AppDatabaseStore, Row } from './AppDatabaseStore.js';
import type { AppUser } from './AppAuthService.js';
import type { AppAccess, AppTable } from '../../domain/app-backend/AppSchema.js';
import {
  AppAccessDeniedError,
  AppBackendNotProvisionedError,
  AppTableNotAllowedError,
} from '../../domain/app-backend/errors.js';
import { assertWithinQuota } from './CheckQuota.js';

type Deps = {
  readonly appBackends: AppBackendRepository;
  readonly appDb: AppDatabaseStore;
};

export type RunAppQueryInput = {
  readonly projectId: string;
  readonly table: string;
  readonly op: 'select' | 'insert' | 'update' | 'delete';
  readonly filter?: Row;
  readonly sort?: { readonly column: string; readonly dir: 'asc' | 'desc' };
  readonly limit?: number;
  readonly offset?: number;
  readonly values?: Row;
  readonly id?: string;
  readonly currentUser?: AppUser | null;
};

export type RunAppQueryResult = Row[] | Row | null | { readonly deleted: number };

// Data-API пользовательского приложения: CRUD поверх таблиц ОБЪЯВЛЕННОЙ схемы, с проверкой правил
// доступа (anyone/authenticated/owner) и квоты. Системные таблицы `_*` через data-API недоступны
// (только через AppAuthService). Клиентские имена полей санитайзятся к белому списку схемы.
export class RunAppQuery {
  constructor(private readonly deps: Deps) {}

  async execute(input: RunAppQueryInput): Promise<RunAppQueryResult> {
    const backend = await this.deps.appBackends.getByProject(input.projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) {
      throw new AppBackendNotProvisionedError(input.projectId);
    }
    const table = backend.schema.tables.find((t) => t.name === input.table);
    if (!table) throw new AppTableNotAllowedError(input.table);

    const user = input.currentUser ?? null;
    const fields = new Set(table.fields.map((f) => f.name));

    if (input.op === 'select') {
      this.requireAccess(table.rules.read, user);
      const where = this.sanitizeFilter(input.filter, fields);
      if (table.rules.read === 'owner') where.owner_id = user!.id;
      const orderBy =
        input.sort && (fields.has(input.sort.column) || input.sort.column === 'created_at')
          ? input.sort
          : undefined;
      return this.deps.appDb.select(input.projectId, table.name, {
        where,
        orderBy,
        limit: input.limit,
        offset: input.offset,
      });
    }

    // --- операции записи ---
    this.requireAccess(table.rules.write, user);

    if (input.op === 'insert') {
      assertWithinQuota(this.deps.appDb.sizeBytes(input.projectId), backend.storageLimitBytes);
      const values = this.sanitizeValues(input.values, fields);
      if (user) values.owner_id = user.id;
      const row = this.deps.appDb.insert(input.projectId, table.name, values);
      await this.syncUsage(input.projectId);
      return row;
    }

    if (input.op === 'update') {
      if (!input.id) throw new AppAccessDeniedError('id required');
      this.requireOwnership(input.projectId, table, input.id, user);
      assertWithinQuota(this.deps.appDb.sizeBytes(input.projectId), backend.storageLimitBytes);
      const values = this.sanitizeValues(input.values, fields);
      this.deps.appDb.update(input.projectId, table.name, input.id, values);
      await this.syncUsage(input.projectId);
      return this.deps.appDb.findOne(input.projectId, table.name, { id: input.id });
    }

    // delete — квоту не проверяем (удаление освобождает место).
    if (!input.id) throw new AppAccessDeniedError('id required');
    this.requireOwnership(input.projectId, table, input.id, user);
    const deleted = this.deps.appDb.remove(input.projectId, table.name, input.id);
    await this.syncUsage(input.projectId);
    return { deleted };
  }

  private async syncUsage(projectId: string): Promise<void> {
    await this.deps.appBackends.setUsage(projectId, this.deps.appDb.sizeBytes(projectId));
  }

  private requireAccess(access: AppAccess, user: AppUser | null): void {
    if (access === 'anyone') return;
    if (!user) throw new AppAccessDeniedError('authentication required');
    // 'authenticated' и 'owner' оба требуют юзера; построчная проверка owner — в requireOwnership.
  }

  private requireOwnership(
    projectId: string,
    table: AppTable,
    id: string,
    user: AppUser | null,
  ): void {
    if (table.rules.write !== 'owner') return;
    const row = this.deps.appDb.findOne(projectId, table.name, { id });
    if (!row) throw new AppAccessDeniedError('row not found');
    if (String(row.owner_id) !== user!.id) throw new AppAccessDeniedError('not the owner');
  }

  private sanitizeFilter(filter: Row | undefined, fields: Set<string>): Row {
    const out: Row = {};
    if (!filter) return out;
    for (const [k, v] of Object.entries(filter)) {
      if (fields.has(k) || k === 'id' || k === 'owner_id') out[k] = v;
    }
    return out;
  }

  private sanitizeValues(values: Row | undefined, fields: Set<string>): Row {
    // Только объявленные поля; id/owner_id/created_at — управляются рантаймом, не клиентом.
    const out: Row = {};
    if (!values) return out;
    for (const [k, v] of Object.entries(values)) {
      if (fields.has(k)) out[k] = v;
    }
    return out;
  }
}
