// Настройки исполнения LLM-запросов (одна запись на платформу, db/157).

// Очереди коротких заданий, которые сервер может выполнять сам вместо диспетчера.
export type LlmServerQueue = 'ai_prompt' | 'ai_conversation' | 'monitoring' | 'commit_sync';

export const LLM_SERVER_QUEUES: readonly LlmServerQueue[] = [
  'ai_prompt',
  'ai_conversation',
  'monitoring',
  'commit_sync',
];

// Уровень модели для задания: 'default' — качество (длинные ответы, анализ), 'fast' —
// скорость и экономия лимита подписки (переформулировки, разбор, классификация).
export type LlmModelTier = 'default' | 'fast';

// Модели по умолчанию, пока админ не выбрал свои. Лимит подписки общий на всех, поэтому
// короткие задания по умолчанию идут на быструю модель с большим лимитом сообщений.
export const DEFAULT_LLM_MODEL = 'gpt-6.1-sol';
export const DEFAULT_LLM_FAST_MODEL = 'gpt-6-luna';

export type LlmSettings = {
  readonly defaultModel: string;
  readonly fastModel: string;
  readonly serverQueues: readonly LlmServerQueue[];
  readonly updatedAt: Date | null;
};

// Имя модели провайдера (gpt-6.1-sol, gpt-5.5 …): только безопасные символы.
const LLM_MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

export function isValidLlmModelName(value: string): boolean {
  return LLM_MODEL_NAME_RE.test(value);
}

export function isLlmServerQueue(value: string): value is LlmServerQueue {
  return (LLM_SERVER_QUEUES as readonly string[]).includes(value);
}

export function modelForTier(settings: LlmSettings, tier: LlmModelTier): string {
  return tier === 'fast' ? settings.fastModel : settings.defaultModel;
}
