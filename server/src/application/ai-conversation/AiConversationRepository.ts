import type {
  AiConversation,
  AiConversationKind,
} from '../../domain/ai-conversation/AiConversation.js';
import type { AiAgentStep } from '../../domain/ai-conversation/AiAgentStep.js';
import type { AiConversationEvent } from '../../domain/ai-conversation/AiConversationEvent.js';
import type { AiKnowledgeSource } from '../../domain/ai-conversation/AiKnowledgeSource.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type { AiSuggestion } from '../../domain/ai-conversation/AiSuggestion.js';
import type {
  AiConversationRun,
  AiConversationRunMode,
  PendingAiConversationRun,
} from '../../domain/ai-conversation/AiRun.js';

export type AiMutationResult<T> = {
  readonly value: T;
  readonly events: readonly AiConversationEvent[];
};

export type ListAiConversationsQuery = {
  readonly kind?: AiConversationKind;
  readonly projectId?: string;
  // Project linkage filter, independent of kind: 'none' = general conversations
  // (project_id IS NULL), 'any' = conversations bound to some project.
  readonly projectLink?: 'none' | 'any';
  readonly search?: string;
  readonly archived?: boolean;
  readonly before?: Date;
  readonly limit: number;
};

export type ListAiMessagesQuery = {
  readonly beforeSeq?: number;
  readonly afterSeq?: number;
  readonly limit: number;
};

export type CreateAiConversationRecord = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly kind: AiConversationKind;
  readonly title: string;
};

export type CreateAiMessageRunRecord = {
  readonly conversationId: string;
  readonly ownerUserId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly runId: string;
  readonly body: string;
  readonly titleFallback: string | null;
  readonly clientRequestId: string;
  readonly dispatcherUserId: string;
  readonly projectId: string | null;
  readonly mode: AiConversationRunMode;
  readonly contextVersion: number;
  readonly contextSnapshot: Readonly<Record<string, unknown>> | null;
  // Metadata пользовательского сообщения — сейчас это ссылка на зону сайта у промпта
  // правки. Метаданные ассистента пишет уже completeRun, поэтому поле только одно.
  readonly userMessageMetadata?: Readonly<Record<string, unknown>> | null;
  // Job визуального редактора, который исполняет этот промпт. По нему job находит свой
  // run на завершении — и по нему же run исключается из очереди воркера чата.
  readonly projectEditJobId?: string | null;
  readonly expectedConversationVersion?: number;
  readonly requestId?: string | null;
};

export type AiMessageRunResult = {
  readonly conversation: AiConversation;
  readonly userMessage: AiConversationMessage;
  readonly assistantMessage: AiConversationMessage;
  readonly run: AiConversationRun;
  readonly replayed: boolean;
};

export type ClaimAiConversationRunInput = {
  readonly runId: string;
  readonly dispatcherUserId: string;
  readonly leaseTokenHash: string;
  readonly leaseExpiresAt: Date;
};

// Кто закрывает run. Воркер чата приходит с lease-токеном, выданным ему на claim;
// job визуального редактора lease не получает вовсе (см. *ForEditJob ниже), поэтому
// доступ отделён от полезной нагрузки, а не размазан по ней.
export type AiRunLeaseAuth = {
  readonly runId: string;
  readonly dispatcherUserId: string;
  readonly leaseTokenHash: string;
};

export type AiRunCompletionPayload = {
  readonly completionIdempotencyKey: string;
  readonly body: string;
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costUsd: number | null;
  // Шаги, просмотренные источники и подсказки следующего хода едут в metadata_json
  // ассистентского сообщения. null = воркер их не прислал; уже записанные значения при
  // этом не затираются.
  readonly steps?: readonly AiAgentStep[] | null;
  readonly knowledge?: readonly AiKnowledgeSource[] | null;
  readonly suggestions?: readonly AiSuggestion[] | null;
  readonly requestId?: string | null;
};

export type AiRunFailurePayload = {
  readonly completionIdempotencyKey: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly retryable: boolean;
  readonly requestId?: string | null;
};

export type CompleteAiConversationRunInput = AiRunCompletionPayload & AiRunLeaseAuth;
export type FailAiConversationRunInput = AiRunFailurePayload & AiRunLeaseAuth;

// Завершение run'а, созданного job'ом визуального редактора. Run ищется по
// project_edit_job_id — колонке, которую пишет только сервер.
export type CompleteAiRunForEditJobInput = AiRunCompletionPayload & {
  readonly projectEditJobId: string;
};
export type FailAiRunForEditJobInput = AiRunFailurePayload & {
  readonly projectEditJobId: string;
};

export type AiRunMutationValue = {
  readonly run: AiConversationRun;
  readonly assistantMessage: AiConversationMessage;
};

export interface AiConversationRepository {
  listForOwner(ownerUserId: string, query: ListAiConversationsQuery): Promise<AiConversation[]>;
  findById(id: string): Promise<AiConversation | null>;
  findProjectStudioForOwner(ownerUserId: string, projectId: string): Promise<AiConversation | null>;
  create(input: CreateAiConversationRecord): Promise<AiMutationResult<AiConversation>>;
  rename(
    id: string,
    ownerUserId: string,
    title: string,
    expectedVersion?: number,
  ): Promise<AiMutationResult<AiConversation> | null>;
  setArchived(
    id: string,
    ownerUserId: string,
    archived: boolean,
    expectedVersion?: number,
  ): Promise<AiMutationResult<AiConversation> | null>;

  listMessages(conversationId: string, query: ListAiMessagesQuery): Promise<AiConversationMessage[]>;
  createMessageRun(
    input: CreateAiMessageRunRecord,
  ): Promise<AiMutationResult<AiMessageRunResult> | null>;
  cancelRun(
    conversationId: string,
    ownerUserId: string,
    runId: string,
    requestId?: string | null,
  ): Promise<AiMutationResult<AiRunMutationValue> | null>;

  listEvents(conversationId: string, afterEventSeq: number, limit: number): Promise<AiConversationEvent[]>;

  listPendingForDispatcher(dispatcherUserId: string, limit: number): Promise<PendingAiConversationRun[]>;
  claimRun(input: ClaimAiConversationRunInput): Promise<AiMutationResult<AiConversationRun> | null>;
  completeRun(input: CompleteAiConversationRunInput): Promise<AiMutationResult<AiRunMutationValue> | null>;
  failRun(input: FailAiConversationRunInput): Promise<AiMutationResult<AiRunMutationValue> | null>;

  /**
   * Внутренний путь завершения: run закрывает job визуального редактора, а не воркер
   * чата. Отдельный вход нужен потому, что тот воркер аутентифицирован как диспетчер
   * проекта и lease-токена чата у него нет — выдать ему lease значило бы дать право
   * закрывать любой run диспетчера, включая чужие диалоги.
   * null — у job'а нет связанного run'а (job создан не из чата).
   */
  completeRunForEditJob(
    input: CompleteAiRunForEditJobInput,
  ): Promise<AiMutationResult<AiRunMutationValue> | null>;
  failRunForEditJob(
    input: FailAiRunForEditJobInput,
  ): Promise<AiMutationResult<AiRunMutationValue> | null>;
}
