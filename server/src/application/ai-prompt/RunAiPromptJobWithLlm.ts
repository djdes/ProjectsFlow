import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import type { GenerateLlmText, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';
import type { CompleteAiPromptJob } from './CompleteAiPromptJob.js';
import { AiPromptJobNotInRunningStateError } from '../../domain/ai-prompt/errors.js';
import type { AiPromptKbBundle } from './GetAiPromptKbBundle.js';
import { AI_PROMPT_IMPROVE_TEMPLATE } from './prompts/improvePrompt.js';
import { COMPOSE_PASS1_TEMPLATE } from './prompts/composePass1Prompt.js';
import { COMPOSE_PASS2_TEMPLATE } from './prompts/composePass2Prompt.js';
import { TASKSFLOW_TEMPLATE } from './prompts/tasksflowPrompt.js';
import { COMPOSE_PASS1_SCHEMA, COMPOSE_PASS2_SCHEMA } from './prompts/composeSchemas.js';
import type { LlmJsonSchema } from '../llm/LlmTransport.js';
import { RUN_PROMPT_INSTRUCTIONS, fillPromptTemplate } from '../llm/promptTemplate.js';

// Серверное исполнение заданий кнопок «AI» (improve, compose, compose-advanced и конверт
// TasksFlow) через подписку ChatGPT — замена ai-job-worker.ps1 на машине диспетчера.
// Логика и промпты перенесены из воркера один к одному; режим 'assistant' (очередь
// продуктов) сервер не исполняет — его по-прежнему забирают продуктовые воркеры.

const MAX_OUTPUT_CHARS = 600_000;
const MAX_ERROR_CHARS = 500;
// Клиент ждёт improve до 50 с, compose повторами до 960 с; очистка снимает job через 5 минут.
const IMPROVE_TIMEOUT_MS = 90_000;
const COMPOSE_TIMEOUT_MS = 270_000;
const TASKSFLOW_TIMEOUT_MS = 240_000;

const DOW_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

type Deps = {
  // Тот же путь завершения, что у диспетчера: проверка статуса running и лимиты длины.
  readonly complete: Pick<CompleteAiPromptJob, 'execute'>;
  readonly llm: GenerateLlmText;
  // Полная KB задетектированных проектов для compose-advanced (читается от имени создателя).
  readonly loadKbBundles: (job: AiPromptJob, projectIds: readonly string[]) => Promise<readonly AiPromptKbBundle[]>;
};

class JobFailure extends Error {}

export class RunAiPromptJobWithLlm {
  constructor(private readonly deps: Deps) {}

  // job уже забран (status=running). Всегда завершает его — успехом или ошибкой.
  async execute(job: AiPromptJob): Promise<void> {
    try {
      const outcome = isTasksFlowEnvelope(job.inputText)
        ? await this.tasksFlow(job)
        : job.mode === 'compose'
          ? await this.compose(job)
          : job.mode === 'compose-advanced'
            ? await this.composeAdvanced(job)
            : await this.improve(job);
      if (!outcome.text) throw new JobFailure('empty_output');
      if (outcome.text.length > MAX_OUTPUT_CHARS) throw new JobFailure('compose_result_too_large');
      await this.finish(job, {
        ok: true,
        improvedText: outcome.text,
        error: null,
        costUsd: outcome.llm.costUsd,
        tokensIn: outcome.llm.usage?.inputTokens ?? null,
        tokensOut: outcome.llm.usage?.outputTokens ?? null,
      });
    } catch (e) {
      if (e instanceof AiPromptJobNotInRunningStateError) return;
      const message = e instanceof Error ? e.message : String(e);
      await this.finish(job, {
        ok: false,
        improvedText: null,
        error: (e instanceof JobFailure ? message : `llm_failed: ${message}`).slice(0, MAX_ERROR_CHARS),
      });
    }
  }

  // Задание могли снять по таймауту, пока шёл запрос к модели (AiPromptJobCleanup, 5 минут):
  // тогда результат уже никому не нужен и статус cancelled не перезаписываем.
  private async finish(
    job: AiPromptJob,
    result: {
      ok: boolean;
      improvedText: string | null;
      error: string | null;
      costUsd?: number | null;
      tokensIn?: number | null;
      tokensOut?: number | null;
    },
  ): Promise<void> {
    try {
      await this.deps.complete.execute({ userId: job.dispatcherUserId, jobId: job.id, ...result });
    } catch (e) {
      if (e instanceof AiPromptJobNotInRunningStateError) return;
      throw e;
    }
  }

  private async improve(job: AiPromptJob): Promise<Outcome> {
    const kbBlock = job.kbContext?.trim()
      ? `Контекст проекта (база знаний):\n${job.kbContext}\n\n---\n\n`
      : '';
    const prompt = fillPromptTemplate(AI_PROMPT_IMPROVE_TEMPLATE, {
      KB_CONTEXT_BLOCK: kbBlock,
      INPUT_TEXT: job.inputText,
    });
    const llm = await this.generate(job, prompt, 'default', 'low', IMPROVE_TIMEOUT_MS);
    return { text: llm.text.trim(), llm };
  }

  private async compose(job: AiPromptJob): Promise<Outcome> {
    const candidates = job.kbContext?.trim() ? job.kbContext : '(нет проектов-кандидатов)';
    const prompt = fillPromptTemplate(COMPOSE_PASS1_TEMPLATE, { CANDIDATES_BLOCK: candidates, INPUT_TEXT: job.inputText });
    const llm = await this.generate(job, prompt, 'fast', 'medium', COMPOSE_TIMEOUT_MS, COMPOSE_PASS1_SCHEMA);
    const parsed = parseComposeJson(llm.text);
    if (!parsed) throw new JobFailure('compose_pass1_bad_json');
    // advancedBody здесь не считается — его доберёт ленивый проход 2 (compose-advanced).
    const segments = parsed.segments.map((raw) => {
      const s = asRecord(raw);
      const confidence = Number(s['confidence']);
      return {
        id: str(s['id']),
        title: str(s['title']),
        simpleBody: str(s['simpleBody']),
        projectId: strOrNull(s['projectId']),
        projectName: strOrNull(s['projectName']),
        confidence: Number.isFinite(confidence) ? confidence : 0,
        assigneeUserId: strOrNull(s['assigneeUserId']),
        assigneeName: strOrNull(s['assigneeName']),
        deadline: strOrNull(s['deadline']),
        // Поля промпта pass-1, которые читают Telegram-композер (parseComposeSegments) и веб
        // (ComposeTasks): тип задачи, дополнение существующей задачи и дословный пункт сообщения
        // для комментария «Оригинал». Воркер Ralph их терял при пересборке — здесь не теряем.
        taskType: s['taskType'] === 'bug' || s['taskType'] === 'feature' ? s['taskType'] : null,
        existingTaskId: strOrNull(s['existingTaskId']),
        sourceExcerpt: strOrNull(s['sourceExcerpt']),
      };
    });
    return { text: JSON.stringify({ version: 1, mode: 'compose', segments }), llm };
  }

  private async composeAdvanced(job: AiPromptJob): Promise<Outcome> {
    let input: { segments?: unknown } | null = null;
    try {
      input = JSON.parse(job.inputText) as { segments?: unknown };
    } catch {
      input = null;
    }
    if (!input || !Array.isArray(input.segments) || input.segments.length === 0) {
      throw new JobFailure('compose_advanced_bad_input');
    }
    const segmentsIn = input.segments.map(asRecord);
    const projectIds = [...new Set(segmentsIn.map((s) => str(s['projectId'])).filter((id) => id.length > 0))];
    let kbBundles = '';
    if (projectIds.length > 0) {
      const bundles = await this.deps.loadKbBundles(job, projectIds).catch(() => []);
      kbBundles = bundles
        .map((b) => `### Проект: ${b.name} [projectId=${b.projectId}]\n${b.kb ?? '(KB не подключена)'}`)
        .join('\n\n---\n\n');
    }
    if (!kbBundles.trim()) kbBundles = '(базы знаний недоступны)';

    const segmentsJson = JSON.stringify(
      segmentsIn.map((s) => ({
        id: str(s['id']),
        title: str(s['title']),
        simpleBody: str(s['simpleBody']),
        projectName: strOrNull(s['projectName']),
      })),
    );
    const prompt = fillPromptTemplate(COMPOSE_PASS2_TEMPLATE, { SEGMENTS_JSON: segmentsJson, KB_BUNDLES: kbBundles });
    const llm = await this.generate(job, prompt, 'default', 'medium', COMPOSE_TIMEOUT_MS, COMPOSE_PASS2_SCHEMA);
    const parsed = parseComposeJson(llm.text);
    if (!parsed) throw new JobFailure('compose_pass2_bad_json');

    const advancedById = new Map<string, string>();
    for (const raw of parsed.segments) {
      const s = asRecord(raw);
      const id = str(s['id']);
      const body = str(s['advancedBody']);
      if (id && body) advancedById.set(id, body);
    }
    // На каждый входной сегмент отдаём advancedBody (если модель его пропустила — simpleBody).
    const segments = segmentsIn.map((s) => {
      const id = str(s['id']);
      return { id, advancedBody: advancedById.get(id) || str(s['simpleBody']) };
    });
    return { text: JSON.stringify({ version: 1, mode: 'compose-advanced', segments }), llm };
  }

  private async tasksFlow(job: AiPromptJob): Promise<Outcome> {
    let envelope: Record<string, unknown>;
    try {
      envelope = asRecord(JSON.parse(job.inputText));
    } catch {
      throw new JobFailure('tasksflow_bad_envelope');
    }
    // Список сотрудников TasksFlow уже отфильтровал по правам автора.
    const members = Array.isArray(envelope['members'])
      ? envelope['members'].map(asRecord).map((m) => {
          const position = str(m['position']);
          return `- id=${str(m['id'])}: ${str(m['name'])}${position ? ` — ${position}` : ''}`;
        })
      : [];
    const categories = Array.isArray(envelope['categories'])
      ? envelope['categories'].map((c) => `- ${String(c)}`)
      : [];
    const dow = Number(envelope['dow']);
    const author = asRecord(envelope['author']);
    const prompt = fillPromptTemplate(TASKSFLOW_TEMPLATE, {
      TODAY: str(envelope['today']),
      DOW_NAME: DOW_NAMES[Number.isInteger(dow) && dow >= 0 && dow <= 6 ? dow : 0] ?? DOW_NAMES[0]!,
      AUTHOR: `${str(author['name'])} (${str(author['role'])})`,
      MEMBERS: members.length > 0 ? members.join('\n') : '(список пуст)',
      CATEGORIES: categories.length > 0 ? categories.join('\n') : '(категорий пока нет)',
      HAS_PHOTOS: psBool(envelope['hasPhotos']),
      MESSAGE: str(envelope['message']),
    });
    const llm = await this.generate(job, prompt, 'fast', 'medium', TASKSFLOW_TIMEOUT_MS);
    const parsed = parseComposeJson(llm.text);
    if (!parsed) throw new JobFailure('tasksflow_bad_json');
    return { text: JSON.stringify(parsed.raw), llm };
  }

  private generate(
    job: AiPromptJob,
    prompt: string,
    tier: 'default' | 'fast',
    reasoningEffort: 'low' | 'medium',
    timeoutMs: number,
    // Compose отвечает JSON-ом, который разбирают бот и веб: по схеме модель не вернёт битый
    // JSON (быстрая модель изредка ломала его на длинных сообщениях — бот уходил в ручной флоу).
    jsonSchema?: LlmJsonSchema,
  ): Promise<GenerateLlmTextResult> {
    return this.deps.llm.generate({
      billedUserId: job.createdBy,
      tier,
      instructions: RUN_PROMPT_INSTRUCTIONS,
      input: prompt,
      reasoningEffort,
      timeoutMs,
      ...(jsonSchema ? { jsonSchema } : {}),
    });
  }
}

type Outcome = { readonly text: string; readonly llm: GenerateLlmTextResult };

// Конверт TasksFlow опознаётся по маркеру app='tasksflow' внутри JSON (mode у него improve).
export function isTasksFlowEnvelope(inputText: string): boolean {
  const trimmed = inputText.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    return asRecord(JSON.parse(trimmed))['app'] === 'tasksflow';
  } catch {
    return false;
  }
}

// Снимает markdown-заборы, вырезает JSON из текста вокруг и требует непустой segments
// (как Parse-ComposeJson в воркере).
export function parseComposeJson(text: string): { segments: unknown[]; raw: Record<string, unknown> } | null {
  let s = text.trim();
  if (!s) return null;
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '').trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const raw = asRecord(JSON.parse(s.slice(start, end + 1)));
    const segments = raw['segments'];
    if (!Array.isArray(segments) || segments.length === 0) return null;
    return { segments, raw };
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function strOrNull(value: unknown): string | null {
  const s = str(value);
  return s ? s : null;
}

// PowerShell [string]$true даёт 'True' — промпт TasksFlow писался под этот вид.
function psBool(value: unknown): string {
  if (value === true) return 'True';
  if (value === false) return 'False';
  return str(value);
}
