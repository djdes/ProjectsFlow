export type AiPromptJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const AI_PROMPT_JOB_STATUSES: readonly AiPromptJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

// Режим job'а.
// 'improve' — legacy одиночное улучшение (plain-текст в improvedText).
// 'compose' — ПРОХОД 1: разбивка текста на задачи + «Простой» вариант + классификация
//   по проектам/ответственным/срокам; результат едет JSON-строкой в improvedText.
//   «Продвинутый» вариант здесь НЕ считается (ленивый — отдельным job'ом ниже).
// 'compose-advanced' — ПРОХОД 2: по сегментам из pass-1 (приходят JSON-строкой в inputText)
//   и полной KB задетектированных проектов считает только advancedBody («Продвинутый»).
//   Запускается лениво, когда пользователь открыл вкладку «Продвинутый» в UI.
// 'assistant' — невидимая очередь ИИ-ассистентов продуктов (DocsFlow, ScanFlow): inputText
//   уже самодостаточная инструкция (frontmatter + шаги), KB сервер не собирает, результат
//   потребляет сам продукт. Ставится ТОЛЬКО через agent-API (Bearer), из браузера недоступен.
// 'text' — универсальный текстовый шлюз Codex (POST /api/ai/text-jobs, db/180): inputText —
//   JSON-конверт { v: 1, instructions, input }, KB не собирается, исполняет ai-job-worker
//   Ralph (локальный codex exec по подписке), результат — готовый текст в improvedText.
export type AiPromptJobMode = 'improve' | 'compose' | 'compose-advanced' | 'assistant' | 'text';

export const AI_PROMPT_JOB_MODES: readonly AiPromptJobMode[] = [
  'improve',
  'compose',
  'compose-advanced',
  'assistant',
  'text',
];

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
