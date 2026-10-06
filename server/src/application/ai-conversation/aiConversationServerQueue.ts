import { randomBytes } from 'node:crypto';
import type { AiConversationRun, AiConversationRunMode } from '../../domain/ai-conversation/AiRun.js';
import { AiConversationRunNotFoundError } from '../../domain/ai-conversation/errors.js';
import type { ServerQueueAdapter } from '../llm/ServerQueueRunner.js';
import type { AiConversationRepository } from './AiConversationRepository.js';
import type { AiConversationService } from './AiConversationService.js';
import type { RunAiConversationRunWithLlm } from './RunAiConversationRunWithLlm.js';

// Режимы, которые сервер исполняет сам: ответ в чате ('chat') и план в студии проекта
// ('studio_plan') — у воркера это чистый «текст на входе — текст на выходе». 'studio_edit'
// правит код сайта: такой run закрывает job визуального редактора (воркер с доступом к
// репозиторию), поэтому он остаётся диспетчеру.
export const SERVER_AI_CONVERSATION_MODES: readonly AiConversationRunMode[] = ['chat', 'studio_plan'];

// Как у POST /agent/ai-conversation-runs/:id/claim.
const LEASE_MS = 5 * 60_000;

type Deps = {
  readonly runs: Pick<AiConversationRepository, 'listQueuedForServer'>;
  readonly conversations: Pick<AiConversationService, 'claimRun'>;
  readonly run: Pick<RunAiConversationRunWithLlm, 'execute'>;
  readonly now?: () => Date;
};

export function aiConversationServerQueue(deps: Deps): ServerQueueAdapter {
  const now = deps.now ?? (() => new Date());
  return {
    queue: 'ai_conversation',
    async claim(limit) {
      const queued = await deps.runs.listQueuedForServer({ modes: SERVER_AI_CONVERSATION_MODES, limit });
      const tasks: Array<() => Promise<void>> = [];
      for (const pending of queued) {
        const leaseToken = randomBytes(32).toString('base64url');
        let run: AiConversationRun;
        try {
          // Сервер выступает диспетчером run'а: claim атомарен и сверяет dispatcher_user_id.
          run = await deps.conversations.claimRun({
            runId: pending.run.id,
            dispatcherUserId: pending.run.dispatcherUserId,
            leaseToken,
            leaseExpiresAt: new Date(now().getTime() + LEASE_MS),
          });
        } catch (e) {
          // Run успел забрать диспетчер или пользователь его отменил — просто пропускаем.
          if (e instanceof AiConversationRunNotFoundError) continue;
          throw e;
        }
        const claimed = { ...pending, run, leaseToken };
        tasks.push(() => deps.run.execute(claimed));
      }
      return tasks;
    },
  };
}
