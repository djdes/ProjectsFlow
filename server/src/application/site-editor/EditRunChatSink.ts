import type { AiAgentStep } from '../../domain/ai-conversation/AiAgentStep.js';
import type { AiSelectionRef } from '../../domain/ai-conversation/AiSelectionRef.js';

/**
 * Узкая щель из визуального редактора в чат проекта: промпт правки обязан попасть в
 * диалог, а ответ ИИ — вернуться в то же сообщение.
 *
 * Целиком AiConversationService сюда не инжектится сознательно. Слайсы иначе видели бы
 * друг друга полностью (site-editor смог бы архивировать диалоги), а тест редактора
 * поднимал бы половину чата. Реализация порта живёт в слайсе чата и связывается в
 * composition root — site-editor ничего про ai-conversation не импортирует, кроме
 * доменных типов шага и ссылки на зону.
 */
export type OpenEditRunChatInput = {
  readonly projectId: string;
  readonly userId: string;
  readonly jobId: string;
  /**
   * Ключ идемпотентности job'а. Из него детерминированно выводится clientRequestId
   * сообщения: повтор той же правки обязан попасть в то же сообщение, иначе каждая
   * повторная отправка добавляла бы в ленту дубль промпта.
   */
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly selection: AiSelectionRef;
};

export type CloseEditRunChatInput = {
  readonly jobId: string;
  readonly status: 'succeeded' | 'failed';
  /** Слова ИИ. Пусто — воркер старой версии их не прислал, уйдёт фолбэк. */
  readonly summary?: string | null;
  readonly steps?: readonly AiAgentStep[] | null;
  readonly error?: string | null;
};

export interface EditRunChatSink {
  openEditRun(input: OpenEditRunChatInput): Promise<void>;
  closeEditRun(input: CloseEditRunChatInput): Promise<void>;
}
