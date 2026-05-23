// Делегирование GitHub-токена владельца проекта Ralph-диспетчеру.
// Хранит только «owner X разрешил» — сам токен НЕ копируется, берётся live из
// user_github_tokens на каждом запросе (рефрэш OAuth подхватывается автоматически).

export type GitTokenDelegation = {
  readonly projectId: string;
  // Чей токен делегируется. Обычно = project.ownerId на момент включения.
  // Use-case на запросе ещё раз проверяет что granter всё ещё owner (если ownership
  // передали — старая делегация невалидна).
  readonly granterUserId: string;
  readonly enabled: boolean;
  // Когда впервые включили. Не затирается при revoke — для UI «история».
  readonly grantedAt: Date | null;
  // Когда последний раз отключили. Сбрасывается в null при повторном enable.
  readonly revokedAt: Date | null;
};

// Outcome'ы для access-log'а. Покрывают все 5 условий из спеки + happy path.
export type GitTokenAccessOutcome =
  | 'ok'
  | 'not_dispatcher'
  | 'delegation_disabled'
  | 'granter_github_disconnected'
  | 'granter_not_owner_anymore';

// Что отдаём диспетчеру на успешный запрос. Token — plaintext GitHub OAuth,
// используется ТОЛЬКО для git-операций в репо этого проекта. Не персистится
// у клиента, не логируется в app-логи (только в access-log таблицу, и там тоже
// без значения — лишь outcome).
export type DelegatedGitToken = {
  readonly token: string;
  readonly login: string;
  readonly scopes: readonly string[];
  // Источник — пока всегда 'owner_delegation'. На будущее: 'collaborator_self'
  // (если разрешим member'ам делегировать) или 'app_install' (GitHub App).
  readonly source: 'owner_delegation';
  readonly grantedBy: string;
  readonly grantedAt: Date;
};
