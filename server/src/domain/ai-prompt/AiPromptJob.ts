export type AiPromptJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const AI_PROMPT_JOB_STATUSES: readonly AiPromptJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

// Режим job'а. 'improve' — legacy одиночное улучшение (plain-текст в improvedText).
// 'compose' — разбивка текста на задачи + 2 варианта переработки («Простой»/«Продвинутый»)
// + классификация по проектам; результат едет JSON-строкой в improvedText.
export type AiPromptJobMode = 'improve' | 'compose';

export const AI_PROMPT_JOB_MODES: readonly AiPromptJobMode[] = ['improve', 'compose'];

export type AiPromptJob = {
  readonly id: string;
  readonly createdBy: string;
  readonly projectId: string | null;
  readonly dispatcherUserId: string;
  readonly status: AiPromptJobStatus;
  readonly mode: AiPromptJobMode;
  readonly inputText: string;
  readonly kbContext: string | null;
  readonly improvedText: string | null;
  readonly error: string | null;
  readonly claimedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
