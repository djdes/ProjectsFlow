export type AiPromptJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const AI_PROMPT_JOB_STATUSES: readonly AiPromptJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

export type AiPromptJob = {
  readonly id: string;
  readonly createdBy: string;
  readonly projectId: string | null;
  readonly dispatcherUserId: string;
  readonly status: AiPromptJobStatus;
  readonly inputText: string;
  readonly kbContext: string | null;
  readonly improvedText: string | null;
  readonly error: string | null;
  readonly claimedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
