import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import { LlmEmptyResponseError } from '../../domain/llm/errors.js';
import type { GenerateLlmText, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';
import type { CompleteMonitoringAnalysisJob } from './CompleteMonitoringAnalysisJob.js';
import { MONITORING_ANALYSIS_TEMPLATE } from './prompts/monitoringAnalysisPrompt.js';
import { RUN_PROMPT_INSTRUCTIONS, fillPromptTemplate } from '../llm/promptTemplate.js';

// Серверное исполнение AI-анализа мониторинга (кнопки «Разобрать снимок/логи», авто-анализ
// critical-алерта) через подписку ChatGPT — замена monitoring-analysis-worker.ps1 на машине
// диспетчера. Промпт и обработка ответа перенесены из воркера один к одному. Завершение идёт
// через тот же CompleteMonitoringAnalysisJob, что и POST .../complete диспетчера: те же проверки
// и метеринг расхода на инициатора (createdBy).

// maxOutputChars воркера по умолчанию (он же потолок resultMarkdown в /complete).
const MAX_OUTPUT_CHARS = 300_000;
const MAX_ERROR_CHARS = 500;
// Watchdog воркера — 120 с по умолчанию (настраивался до 300 с). UI ждёт ответ ~200 с
// (4 long-poll по 50 с), очистка снимает job через 5 минут от создания — 180 с укладываются
// в оба окна с запасом на ожидание в очереди.
const ANALYSIS_TIMEOUT_MS = 180_000;

type Deps = {
  readonly complete: Pick<CompleteMonitoringAnalysisJob, 'execute'>;
  readonly llm: GenerateLlmText;
};

export class RunMonitoringAnalysisJobWithLlm {
  constructor(private readonly deps: Deps) {}

  // job уже забран (status=running). Завершает его успехом или ошибкой модели; сбой самого
  // завершения (например, job уже снят очисткой) пробрасывается — его залогирует раннер.
  async execute(job: MonitoringAnalysisJob): Promise<void> {
    let llm: GenerateLlmTextResult;
    let text: string;
    try {
      llm = await this.deps.llm.generate({
        // Платит инициатор анализа: ручной запуск — пользователь, авто-анализ — владелец проекта.
        billedUserId: job.createdBy,
        tier: 'default',
        instructions: RUN_PROMPT_INSTRUCTIONS,
        input: buildMonitoringAnalysisPrompt(job),
        reasoningEffort: 'medium',
        timeoutMs: ANALYSIS_TIMEOUT_MS,
      });
      text = llm.text.trim();
      if (!text) throw new LlmEmptyResponseError();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.deps.complete.execute({
        userId: job.dispatcherUserId,
        jobId: job.id,
        ok: false,
        resultMarkdown: null,
        error: `llm_failed: ${message}`.slice(0, MAX_ERROR_CHARS),
      });
      return;
    }
    // Use-case проверяет, что завершает диспетчер job'а, — действуем от его имени.
    await this.deps.complete.execute({
      userId: job.dispatcherUserId,
      jobId: job.id,
      ok: true,
      resultMarkdown: text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text,
      error: null,
      costUsd: llm.costUsd,
      tokensIn: llm.usage?.inputTokens ?? null,
      tokensOut: llm.usage?.outputTokens ?? null,
    });
  }
}

// Сборка промпта — как в воркере: заметка пользователя идёт отдельным блоком (пустая — без
// блока), пустой контекст заменяется заглушкой. Замены последовательные, как цепочка .Replace
// в PowerShell: контекст подставляется последним и сам уже не разбирается на плейсхолдеры.
export function buildMonitoringAnalysisPrompt(
  job: Pick<MonitoringAnalysisJob, 'analysisType' | 'note' | 'context'>,
): string {
  const note = job.note ?? '';
  const context = job.context ?? '';
  return fillPromptTemplate(MONITORING_ANALYSIS_TEMPLATE, {
    ANALYSIS_TYPE: job.analysisType || 'snapshot',
    NOTE_BLOCK: note.trim() ? `Вопрос/заметка пользователя: ${note}\n\n` : '',
    CONTEXT: context.trim() ? context : '(контекст пуст)',
  });
}

