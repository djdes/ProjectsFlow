// Подключение платформы к подписке ChatGPT (вход по коду). Зеркало серверного DTO
// /api/admin/llm — токенов здесь нет и быть не может, сервер их не отдаёт.

export type LlmConnectionStatus = 'active' | 'reauth_required' | 'disabled';

// Очереди коротких заданий, которые сервер может выполнять сам вместо диспетчера.
export type LlmServerQueue = 'ai_prompt' | 'ai_conversation' | 'monitoring' | 'commit_sync';

export type LlmConnectionInfo = {
  readonly id: string;
  readonly provider: 'chatgpt';
  readonly status: LlmConnectionStatus;
  readonly accountEmail: string | null;
  readonly planType: string | null;
  readonly accessExpiresAt: string | null;
  readonly lastRefreshAt: string | null;
  readonly rateLimitedUntil: string | null;
  readonly lastError: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
};

// Незавершённый вход: код показан, сервер ждёт подтверждения на сайте OpenAI.
export type LlmPendingLogin = {
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly intervalSec: number;
  readonly expiresAt: string;
};

export type LlmSettings = {
  readonly defaultModel: string;
  readonly fastModel: string;
  readonly serverQueues: readonly LlmServerQueue[];
  readonly updatedAt: string | null;
};

export type LlmAdminStatus = {
  readonly connection: LlmConnectionInfo | null;
  readonly pendingLogin: LlmPendingLogin | null;
  readonly settings: LlmSettings;
};

export type LlmLoginPollResult =
  | { readonly status: 'idle' | 'expired' }
  | { readonly status: 'pending'; readonly pendingLogin: LlmPendingLogin }
  | { readonly status: 'connected'; readonly connection: LlmConnectionInfo };

export type LlmTestResult = {
  readonly ok: boolean;
  readonly model: string;
  readonly latencyMs: number;
  readonly reply: string | null;
  readonly error: string | null;
};
