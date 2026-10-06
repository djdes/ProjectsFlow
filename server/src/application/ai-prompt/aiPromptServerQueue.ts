import type { AiPromptJobMode } from '../../domain/ai-prompt/AiPromptJob.js';
import type { ServerQueueAdapter } from '../llm/ServerQueueRunner.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';
import type { RunAiPromptJobWithLlm } from './RunAiPromptJobWithLlm.js';

// Режимы, которые сервер исполняет сам. 'assistant' остаётся продуктовым воркерам: у них
// свои системные промпты и обработка вложений.
export const SERVER_AI_PROMPT_MODES: readonly AiPromptJobMode[] = ['improve', 'compose', 'compose-advanced'];

type Deps = {
  readonly aiPromptJobs: Pick<AiPromptJobRepository, 'listQueued' | 'claimById'>;
  readonly run: Pick<RunAiPromptJobWithLlm, 'execute'>;
};

export function aiPromptServerQueue(deps: Deps): ServerQueueAdapter {
  return {
    queue: 'ai_prompt',
    async claim(limit) {
      const queued = await deps.aiPromptJobs.listQueued({ modes: SERVER_AI_PROMPT_MODES, limit });
      const tasks: Array<() => Promise<void>> = [];
      for (const job of queued) {
        // claim атомарен: если задание успел взять диспетчер, просто пропускаем.
        const claimed = await deps.aiPromptJobs.claimById(job.id);
        if (claimed) tasks.push(() => deps.run.execute(claimed));
      }
      return tasks;
    },
  };
}
