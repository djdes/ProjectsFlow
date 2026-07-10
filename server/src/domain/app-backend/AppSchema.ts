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
};

export type AppTableRules = {
  readonly read: AppAccess;
  readonly write: AppAccess;
};

export type AppTable = {
  readonly name: string;
  readonly fields: readonly AppField[];
  readonly rules: AppTableRules;
};

export type AppSchema = {
  readonly tables: readonly AppTable[];
};
