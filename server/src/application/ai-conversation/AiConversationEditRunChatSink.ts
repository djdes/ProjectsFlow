import { createHash } from 'node:crypto';
import { normalizeSelectionRef } from '../../domain/ai-conversation/AiSelectionRef.js';
import type {
  CloseEditRunChatInput,
  EditRunChatSink,
  OpenEditRunChatInput,
} from '../site-editor/EditRunChatSink.js';
import type { AiConversationService } from './AiConversationService.js';

/**
 * Реализация порта site-editor'а поверх чата: промпт правки элемента становится парой
 * сообщений в диалоге проекта, а завершение job'а закрывает ассистентское сообщение.
 *
 * Зависимость сужена до Pick: адаптеру нужны четыре метода, а не весь сервис.
 */
export type EditRunConversations = Pick<
  AiConversationService,
  'getOrCreateProjectStudio' | 'sendMessage' | 'completeRunFromEditJob' | 'failRunFromEditJob'
>;

export type AiConversationEditRunChatSinkDeps = {
  readonly conversations: EditRunConversations;
};

// Пространство имён для вывода clientRequestId, чтобы ключ правки нельзя было
// подобрать под ключ обычного сообщения чата.
const REQUEST_ID_NAMESPACE = 'projectsflow.site-editor.edit-job';

const DONE_FALLBACK = 'Готово — правка элемента выполнена. Проверьте результат в предпросмотре.';
const FAILED_FALLBACK = 'Не удалось применить правку элемента.';
const ERROR_CODE = 'SITE_EDITOR_JOB_FAILED';

export class AiConversationEditRunChatSink implements EditRunChatSink {
  constructor(private readonly deps: AiConversationEditRunChatSinkDeps) {}

  async openEditRun(input: OpenEditRunChatInput): Promise<void> {
    const conversation = await this.deps.conversations.getOrCreateProjectStudio(
      input.userId,
      input.projectId,
    );
    await this.deps.conversations.sendMessage(input.userId, conversation.id, {
      body: input.prompt,
      clientRequestId: deterministicRequestId(input.idempotencyKey),
      mode: 'studio_edit',
      // Нормализуем даже свой же вход: инвариант «в metadata лежит только приведённая
      // ссылка на зону» не должен зависеть от того, кто позвал порт.
      selection: normalizeSelectionRef(input.selection),
      projectEditJobId: input.jobId,
    });
  }

  async closeEditRun(input: CloseEditRunChatInput): Promise<void> {
    const completionIdempotencyKey = `edit-job:${input.jobId}`.slice(0, 100);
    if (input.status === 'succeeded') {
      await this.deps.conversations.completeRunFromEditJob({
        projectEditJobId: input.jobId,
        completionIdempotencyKey,
        // Воркер старой версии summary не шлёт: без фолбэка в чате осталось бы пустое
        // сообщение, хотя правка выполнена.
        body: input.summary?.trim() || DONE_FALLBACK,
        model: null,
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        steps: input.steps ?? null,
      });
      return;
    }
    await this.deps.conversations.failRunFromEditJob({
      projectEditJobId: input.jobId,
      completionIdempotencyKey,
      errorCode: ERROR_CODE,
      errorMessage: (input.error?.trim() || FAILED_FALLBACK).slice(0, 500),
      // Правку можно повторить: в UI у неудавшегося сообщения появляется «Повторить».
      retryable: true,
    });
  }
}

/**
 * clientRequestId сообщения — UUID, выведенный из ключа идемпотентности job'а.
 * Колонка client_request_id это CHAR(36) c UNIQUE(conversation_id, client_request_id),
 * так что повтор той же правки попадает в уже существующее сообщение, а не плодит
 * дубли промпта в ленте.
 */
function deterministicRequestId(idempotencyKey: string): string {
  const bytes = createHash('sha256')
    .update(`${REQUEST_ID_NAMESPACE}:${idempotencyKey}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // версия 5, как у name-based UUID
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // вариант RFC 4122
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
