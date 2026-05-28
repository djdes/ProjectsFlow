import type { AiPromptRepository } from './AiPromptRepository';

// Чёткие коды ошибок для UI: компонент сам решает текст toast'а на каждый.
export type ImproveTaskDescriptionErrorCode =
  | 'timeout' // диспетчер не ответил за waitSeconds
  | 'ai_not_configured' // 503 от сервера (нет default dispatcher'а)
  | 'no_dispatcher_for_project' // 503 (у проекта нет диспетчера)
  | 'rate_limited' // 429
  | 'job_failed' // status=failed (Claude API упал, парсинг ответа)
  | 'job_cancelled' // status=cancelled (server cleanup)
  | 'unknown';

export class ImproveTaskDescriptionError extends Error {
  constructor(public readonly code: ImproveTaskDescriptionErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ImproveTaskDescriptionError';
  }
}

export class ImproveTaskDescription {
  constructor(private readonly repo: AiPromptRepository) {}

  async execute(input: { text: string; projectId: string | null }): Promise<string> {
    const { jobId } = await this.repo.enqueue(input);
    const job = await this.repo.waitFor(jobId);
    if (job.status === 'succeeded' && job.improvedText && job.improvedText.length > 0) {
      return job.improvedText;
    }
    if (job.status === 'failed') {
      throw new ImproveTaskDescriptionError('job_failed', job.error ?? 'AI не смог обработать запрос');
    }
    if (job.status === 'cancelled') {
      throw new ImproveTaskDescriptionError('job_cancelled', job.error ?? 'Запрос отменён');
    }
    // queued/running после waitFor — это таймаут (adapter решил вернуть, не бросить).
    throw new ImproveTaskDescriptionError('timeout', 'AI диспетчер не ответил');
  }
}
