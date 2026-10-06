// Подключение к LLM-провайдеру (db/157). Владелец — платформа (одно подключение на всех)
// или пользователь (личное подключение — задел на будущее: схема и маршрутизатор его уже
// понимают, входа в профиле пока нет). Секреты в сущность не входят: токены живут отдельно
// в LlmCredentials и достаются только сервисом доступа.

// 'chatgpt' — подписка ChatGPT через бэкенд Codex, вход по коду (device code).
export type LlmProvider = 'chatgpt';

export type LlmConnectionScope = 'platform' | 'user';

export type LlmConnectionOwner =
  | { readonly scope: 'platform' }
  | { readonly scope: 'user'; readonly userId: string };

export const PLATFORM_OWNER: LlmConnectionOwner = { scope: 'platform' };

export type LlmConnectionStatus = 'active' | 'reauth_required' | 'disabled';

export type LlmConnection = {
  readonly id: string;
  readonly owner: LlmConnectionOwner;
  readonly provider: LlmProvider;
  readonly status: LlmConnectionStatus;
  readonly accountId: string | null;
  readonly accountEmail: string | null;
  readonly planType: string | null;
  readonly accessExpiresAt: Date | null;
  readonly lastRefreshAt: Date | null;
  readonly rateLimitedUntil: Date | null;
  readonly lastError: string | null;
  readonly lastUsedAt: Date | null;
  // Версия строки для оптимистичной блокировки обновления токенов.
  readonly version: number;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type LlmCredentials = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string | null;
};

// Сведения об аккаунте, извлечённые из токенов провайдера при входе или обновлении.
export type LlmAccountInfo = {
  readonly accountId: string | null;
  readonly email: string | null;
  readonly planType: string | null;
  readonly accessExpiresAt: Date | null;
};

// Не-NULL ключ владельца для уникальности (UNIQUE в MariaDB пропускает NULL).
export function llmOwnerKey(owner: LlmConnectionOwner): string {
  return owner.scope === 'platform' ? 'platform' : owner.userId;
}
