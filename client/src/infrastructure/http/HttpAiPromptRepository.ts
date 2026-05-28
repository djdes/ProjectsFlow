import type {
  AiPromptJobResult,
  AiPromptRepository,
  EnqueueAiPromptInput,
} from '@/application/ai/AiPromptRepository';
import { ImproveTaskDescriptionError } from '@/application/ai/ImproveTaskDescription';
import { HttpError, httpClient } from './httpClient';

type EnqueueResponse = {
  jobId: string;
  status: AiPromptJobResult['status'];
  createdAt: string;
};

type WaitResponse = {
  jobId: string;
  status: AiPromptJobResult['status'];
  improvedText: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

// 50 сек — компромисс: opus может тянуть 30-45 сек на длинных KB-контекстах,
// haiku/sonnet укладываются в 5-15 сек. Server hard-cap = 60 сек (см. HARD_MAX_WAIT_MS
// в WaitForAiPromptJob.ts). При желании уменьшить — можно передать waitSeconds в waitFor.
const DEFAULT_WAIT_SECONDS = 50;

export class HttpAiPromptRepository implements AiPromptRepository {
  async enqueue(input: EnqueueAiPromptInput): Promise<{ jobId: string }> {
    try {
      const res = await httpClient.post<EnqueueResponse>('/ai/prompt-jobs', {
        text: input.text,
        projectId: input.projectId,
      });
      return { jobId: res.jobId };
    } catch (e) {
      throw mapEnqueueError(e);
    }
  }

  async waitFor(
    jobId: string,
    waitSeconds: number = DEFAULT_WAIT_SECONDS,
  ): Promise<AiPromptJobResult> {
    try {
      const res = await httpClient.get<WaitResponse>(
        `/ai/prompt-jobs/${encodeURIComponent(jobId)}?wait=${waitSeconds}`,
      );
      return {
        jobId: res.jobId,
        status: res.status,
        improvedText: res.improvedText,
        error: res.error,
      };
    } catch (e) {
      if (e instanceof HttpError && e.status === 504) {
        // Long-poll истёк — возвращаем «всё ещё queued», use-case транслирует в timeout.
        return { jobId, status: 'queued', improvedText: null, error: null };
      }
      throw mapWaitError(e);
    }
  }
}

function mapEnqueueError(e: unknown): ImproveTaskDescriptionError {
  if (e instanceof HttpError) {
    if (e.status === 429) return new ImproveTaskDescriptionError('rate_limited', 'Слишком много AI-запросов');
    if (e.status === 503 && e.body?.error === 'ai_not_configured') {
      return new ImproveTaskDescriptionError('ai_not_configured');
    }
    if (e.status === 503 && e.body?.error === 'no_dispatcher_for_project') {
      return new ImproveTaskDescriptionError('no_dispatcher_for_project');
    }
  }
  return new ImproveTaskDescriptionError('unknown', e instanceof Error ? e.message : String(e));
}

function mapWaitError(e: unknown): ImproveTaskDescriptionError {
  if (e instanceof HttpError) {
    return new ImproveTaskDescriptionError('unknown', e.body?.message ?? `HTTP ${e.status}`);
  }
  return new ImproveTaskDescriptionError('unknown', e instanceof Error ? e.message : String(e));
}
