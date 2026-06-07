// Port-интерфейс для AI-prompt-improvement через Ralph-диспетчера.
// См. docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md
//
// Алгоритм для caller'а (use-case):
// 1. enqueue(text, projectId) → jobId.
// 2. waitFor(jobId) — long-poll, до 25 сек.
// 3. Если status='succeeded' — возвращаем improvedText.
// 4. Иначе — выбрасываем понятную ошибку (use-case переводит в UX-message).

// 'improve' — legacy одиночное улучшение (plain-текст).
// 'compose' — pass-1: разбивка на задачи + «Простой» + классификация (JSON в improvedText).
// 'compose-advanced' — pass-2: ленивый «Продвинутый» по сегментам pass-1 (JSON в improvedText).
export type AiPromptJobMode = 'improve' | 'compose' | 'compose-advanced';

export type EnqueueAiPromptInput = {
  readonly text: string;
  readonly projectId: string | null;
  readonly mode?: AiPromptJobMode;
};

export type AiPromptJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type AiPromptJobResult = {
  readonly jobId: string;
  readonly status: AiPromptJobStatus;
  readonly mode?: AiPromptJobMode;
  readonly improvedText: string | null;
  readonly error: string | null;
};

export interface AiPromptRepository {
  enqueue(input: EnqueueAiPromptInput): Promise<{ jobId: string }>;
  /**
   * Long-poll результата. Возвращает терминальный job либо бросает таймаут-ошибку
   * (adapter сам решает, как мапить HTTP 504).
   */
  waitFor(jobId: string, waitSeconds?: number): Promise<AiPromptJobResult>;
}
