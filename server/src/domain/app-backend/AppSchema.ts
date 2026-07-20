// Объявленная схема пользовательского приложения: какие таблицы/поля и правила доступа.
// Хранится в app_backends.schema_json, применяется к per-project SQLite (CREATE TABLE) и
// используется App Runtime как БЕЛЫЙ СПИСОК — имена таблиц/полей НИКОГДА не берутся из сырого
// ввода клиента, только отсюда (защита от инъекций/обхода). Валидатор — application/validateAppSchema.

// Кто имеет доступ к операции над таблицей:
//  - 'anyone'        — без авторизации (публичное чтение/запись);
//  - 'authenticated' — любой залогиненный энд-юзер приложения;
//  - 'owner'         — только владелец строки (owner_id = current_user.id).
export type AppAccess = 'anyone' | 'authenticated' | 'owner';

// Типы полей таблицы приложения (маппятся на SQLite-типы в SqliteAppDatabaseStore).
export type AppFieldType = 'text' | 'int' | 'real' | 'bool' | 'datetime';

export type AppField = {
  readonly name: string;
  readonly type: AppFieldType;
  readonly required?: boolean;
  readonly unique?: boolean;
  // Явная пометка чувствительности поля. Приоритетнее эвристики по имени, но НЕ отменяет её:
  // sensitiveColumns() берёт объединение (см. domain/app-backend/sensitiveFields.ts). Снять защиту
  // с поля, чьё имя ловит эвристика, простым удалением флага нельзя — только осознанно через UI.
  readonly sensitive?: 'secret' | 'pii';
};

export type AppTableRules = {
  readonly read: AppAccess;
  // Legacy-схемы объявляли только write. Операционные правила позволяют Dashboard
  // настраивать Create / Update / Delete отдельно, сохраняя полную совместимость:
  // если конкретного правила нет, рантайм использует write.
  readonly write: AppAccess;
  readonly create?: AppAccess;
  readonly update?: AppAccess;
  readonly delete?: AppAccess;
};

export type AppCrudOperation = 'create' | 'read' | 'update' | 'delete';

export function appAccessForOperation(
  rules: AppTableRules,
  operation: AppCrudOperation,
): AppAccess {
  if (operation === 'read') return rules.read;
  return rules[operation] ?? rules.write;
}

export type AppTable = {
  readonly name: string;
  readonly fields: readonly AppField[];
  readonly rules: AppTableRules;
};

export type AppSchema = {
  readonly tables: readonly AppTable[];
};

// Служебные колонки, которые App Runtime добавляет и ведёт сам (не объявляются в схеме).
// `updated_at` — версия строки для optimistic concurrency (см. долг 0.1).
export const APP_SERVICE_COLUMNS = ['id', 'owner_id', 'created_at', 'updated_at'] as const;
