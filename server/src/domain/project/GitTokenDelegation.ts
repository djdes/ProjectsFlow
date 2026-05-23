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

// Outcome'ы для access-log'а. С v0.15 модель — per-member: ищем кандидатов в
// порядке owner→displayName ASC, возвращаем первого подходящего. Outcome'ы:
//   ok                            — нашли подходящего, токен отдан
//   not_dispatcher                — caller не диспетчер проекта
//   delegation_disabled           — никто из членов не включил toggle
//   no_eligible_grantor           — кандидаты есть, но ни у кого нет GitHub
//                                   (NEW в v0.15)
// granter_github_disconnected и granter_not_owner_anymore остаются как ENUM
// значения только для совместимости со старыми логами; новая логика их не пишет.
export type GitTokenAccessOutcome =
  | 'ok'
  | 'not_dispatcher'
  | 'delegation_disabled'
  | 'granter_github_disconnected'
  | 'granter_not_owner_anymore'
  | 'no_eligible_grantor';

// Что отдаём диспетчеру на успешный запрос. Token — plaintext GitHub OAuth,
// используется ТОЛЬКО для git-операций в репо этого проекта. Не персистится
// у клиента, не логируется в app-логи (только в access-log таблицу, и там тоже
// без значения — лишь outcome).
export type DelegatedGitToken = {
  readonly token: string;
  readonly login: string;
  readonly scopes: readonly string[];
  // Источник:
  //   'owner_delegation'  — токен project.ownerId (был выбран первым кандидатом)
  //   'member_delegation' — токен другого члена (owner либо не делегировал, либо
  //                         у него нет GitHub; fallback по displayName ASC)
  readonly source: 'owner_delegation' | 'member_delegation';
  readonly grantedBy: string;
  readonly grantedByDisplayName: string;
  readonly grantedAt: Date;
};
