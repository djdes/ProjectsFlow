import type { AiConversationRun } from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationCompletionConflictError,
  AiConversationRunNotFoundError,
  AiConversationRunStateConflictError,
} from '../../domain/ai-conversation/errors.js';
import type { GenerateLlmText, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';
import type { ServerQueuedAiConversationRun } from './AiConversationRepository.js';
import type { AiConversationService } from './AiConversationService.js';
import {
  aiConversationWorkerHistory,
  aiConversationWorkerInputText,
} from './aiConversationWorkerInput.js';
import { AI_CONVERSATION_TEMPLATE } from './prompts/conversationPrompt.js';
import { fillPromptTemplate } from '../llm/promptTemplate.js';

// Серверное исполнение ответов долговечных ИИ-чатов (очередь ai_conversation_runs) через
// подписку ChatGPT — замена ai-conversation-worker.ps1 на машине диспетчера. Промпт,
// контекст и разбор ответа перенесены из воркера один к одному. Run закрывается тем же
// путём, что и POST /agent/ai-conversation-runs/:id/complete|fail (AiConversationService
// с lease-токеном), поэтому события realtime и аудит пишутся как раньше.

// Предел тела ответа — maxOutputChars воркера (и max у completeSchema агентского роута).
const MAX_OUTPUT_CHARS = 100_000;
// error_message в ai_conversation_runs — VARCHAR(500): воркер резал до 900, сервер режет
// по размеру колонки.
const MAX_ERROR_CHARS = 500;
// model в run'е и сообщении — VARCHAR(120), как max у completeSchema.
const MAX_MODEL_CHARS = 120;
// Воркер ждал claude 180 с. Lease run'а — 5 минут: 4 минуты на ответ оставляют запас на
// повтор после обновления токена и на запись ответа, пока lease ещё действует.
const ANSWER_TIMEOUT_MS = 240_000;

// Промпт целиком — в сообщении пользователя, как было у claude -p. Инструкция лишь задаёт
// рамку: правила и контекст — в сообщении, а ответ модели целиком уходит в чат.
const INSTRUCTIONS =
  'Ты — ИИ-помощник платформы ProjectsFlow. В сообщении пользователя — правила, безопасный контекст диалога и новое сообщение собеседника. Следуй правилам и верни только сам ответ собеседнику: он целиком попадёт в чат.';

// Run, забранный сервером: то, что получает воркер диспетчера (run — уже после claim),
// и lease-токен, без которого сервис не даст закрыть run.
export type ClaimedAiConversationRun = ServerQueuedAiConversationRun & {
  readonly leaseToken: string;
};

type Deps = {
  readonly conversations: Pick<AiConversationService, 'completeRun' | 'failRun'>;
  readonly llm: GenerateLlmText;
};

// Причина отказа с кодом, который воркер слал в /fail.
class RunFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RunAiConversationRunWithLlm {
  constructor(private readonly deps: Deps) {}

  // run уже забран (status=running, lease выдан). Всегда пытается его закрыть — ответом или
  // ошибкой. Если run тем временем отменили или lease истёк, закрывать уже нечего.
  async execute(claimed: ClaimedAiConversationRun): Promise<void> {
    let failure: RunFailure;
    try {
      const prompt = buildAiConversationPrompt(claimed);
      const llm = await this.generate(claimed, prompt);
      const text = llm.text.trim();
      if (!text) throw new RunFailure('model_failed', 'empty_response');
      await this.deps.conversations.completeRun({
        runId: claimed.run.id,
        dispatcherUserId: claimed.run.dispatcherUserId,
        leaseToken: claimed.leaseToken,
        completionIdempotencyKey: `complete-${claimed.run.id}`,
        body: text.slice(0, MAX_OUTPUT_CHARS),
        model: llm.model.slice(0, MAX_MODEL_CHARS) || null,
        tokensIn: llm.usage?.inputTokens ?? null,
        tokensOut: llm.usage?.outputTokens ?? null,
        costUsd: llm.costUsd,
        // Воркер не присылал ни шагов, ни источников, ни подсказок: metadata ответа не трогаем.
        steps: null,
        knowledge: null,
        suggestions: null,
        requestId: null,
      });
      return;
    } catch (e) {
      // Как у воркера: сбой модели — model_failed, всё остальное (в т.ч. запись ответа) — worker_error.
      failure = e instanceof RunFailure ? e : new RunFailure('worker_error', errorText(e));
    }
    await this.fail(claimed, failure);
  }

  private async generate(claimed: ClaimedAiConversationRun, prompt: string): Promise<GenerateLlmTextResult> {
    try {
      return await this.deps.llm.generate({
        // Расход подписки записывается на владельца диалога: он и отправил сообщение.
        billedUserId: claimed.ownerUserId,
        tier: 'default',
        instructions: INSTRUCTIONS,
        input: prompt,
        reasoningEffort: 'medium',
        timeoutMs: ANSWER_TIMEOUT_MS,
      });
    } catch (e) {
      throw new RunFailure('model_failed', errorText(e));
    }
  }

  private async fail(claimed: ClaimedAiConversationRun, failure: RunFailure): Promise<void> {
    try {
      await this.deps.conversations.failRun({
        runId: claimed.run.id,
        dispatcherUserId: claimed.run.dispatcherUserId,
        leaseToken: claimed.leaseToken,
        completionIdempotencyKey: `fail-${claimed.run.id}`,
        errorCode: failure.code,
        errorMessage: (failure.message || failure.code).slice(0, MAX_ERROR_CHARS),
        retryable: true,
        requestId: null,
      });
    } catch (e) {
      // Run уже закрыт (пользователь отменил его) или lease истёк и run перезаберут —
      // как у воркера, закрывать нечего. Прочие сбои уходят исполнителю очереди в лог.
      if (isRunGone(e)) return;
      throw e;
    }
  }
}

// Промпт — как у ai-conversation-worker.ps1: шаблон, «(personal chat)» без проекта,
// безопасный контекст = снимок проекта из claim + история диалога в JSON.
export function buildAiConversationPrompt(
  claimed: Pick<ServerQueuedAiConversationRun, 'conversationTitle' | 'projectName' | 'inputText' | 'history'> & {
    readonly run: Pick<AiConversationRun, 'mode' | 'projectId' | 'contextSnapshot'>;
  },
): string {
  const safeContext = JSON.stringify(
    {
      project: claimed.run.contextSnapshot ?? null,
      conversationHistory: aiConversationWorkerHistory(claimed.history),
    },
    null,
    2,
  );
  // Порядок замен — как у последовательных .Replace() воркера.
  return fillPromptTemplate(AI_CONVERSATION_TEMPLATE, {
    CONVERSATION_TITLE: claimed.conversationTitle,
    PROJECT_NAME: claimed.projectName || '(personal chat)',
    MODE: claimed.run.mode,
    SAFE_CONTEXT: safeContext || '(no project context)',
    INPUT_TEXT: aiConversationWorkerInputText(claimed.run, claimed.inputText),
  });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isRunGone(e: unknown): boolean {
  return (
    e instanceof AiConversationRunStateConflictError ||
    e instanceof AiConversationRunNotFoundError ||
    e instanceof AiConversationCompletionConflictError
  );
}
