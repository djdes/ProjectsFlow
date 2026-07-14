import type { AiPromptRepository } from './AiPromptRepository';
import { ImproveTaskDescriptionError } from './ImproveTaskDescription';

// Один сегмент = одна будущая задача. Модель разбивает свободный текст на сегменты,
// для каждого даёт «Простой» и «Продвинутый» вариант + догадку о проекте.
export type ComposeSegment = {
  readonly id: string;
  readonly title: string;
  readonly simpleBody: string;
  readonly advancedBody: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly confidence: number;
  // Ответственный: userId, резолвнутый AI из списка всех участников проекта, или null
  // (при создании null означает текущего пользователя).
  readonly assigneeUserId: string | null;
  // Сырое имя из текста («Олег») — для подсказки, когда userId не сматчился.
  readonly assigneeName: string | null;
  // Дедлайн 'YYYY-MM-DD' (только при явном сроке в тексте) или null.
  readonly deadline: string | null;
};

export type ComposeResult = {
  readonly version: number;
  readonly segments: ComposeSegment[];
};

// Вход ленивого pass-2 («Продвинутый»): минимум, нужный модели + KB-привязка по projectId.
// Берётся из текущих строк ревью (учитывает правки проекта/заголовка пользователем).
export type ComposeAdvanceSegment = {
  readonly id: string;
  readonly title: string;
  readonly simpleBody: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
};

// Результат pass-2: id сегмента → advancedBody. Отсутствующий id = модель не вернула вариант.
export type ComposeAdvancedResult = Record<string, string>;

export type ComposeTasksErrorCode =
  | 'timeout'
  | 'ai_not_configured'
  | 'no_dispatcher_for_project'
  | 'rate_limited'
  | 'job_failed'
  | 'job_cancelled'
  | 'bad_result' // AI вернул не разбираемый JSON
  | 'unknown';

export class ComposeTasksError extends Error {
  constructor(
    public readonly code: ComposeTasksErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ComposeTasksError';
  }
}

// compose тяжелее improve: разбивка + KB многих проектов. Большой/длинный черновик может
// обрабатываться диспетчером минуты (watchdog в ralph до 15 мин). Один long-poll сервера
// ограничен 60с (HARD_MAX_WAIT_MS), поэтому опрашиваем циклом до ~16 минут — чтобы НЕ бросить
// раньше, чем отработает watchdog (иначе ложный compose_pass1:timeout на больших промптах).
const POLL_WAIT_SECONDS = 55;
const MAX_TOTAL_MS = 960_000;

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

export class ComposeTasks {
  constructor(private readonly repo: AiPromptRepository) {}

  async execute(input: { text: string; projectId: string | null }): Promise<ComposeResult> {
    let jobId: string;
    try {
      ({ jobId } = await this.repo.enqueue({
        text: input.text,
        projectId: input.projectId,
        mode: 'compose',
      }));
    } catch (e) {
      throw toComposeError(e);
    }

    try {
      const deadline = Date.now() + MAX_TOTAL_MS;
      let job = await this.repo.waitFor(jobId, POLL_WAIT_SECONDS);
      while (!TERMINAL.has(job.status) && Date.now() < deadline) {
        job = await this.repo.waitFor(jobId, POLL_WAIT_SECONDS);
      }

      if (job.status === 'failed') {
        throw new ComposeTasksError('job_failed', job.error ?? 'AI не смог обработать запрос');
      }
      if (job.status === 'cancelled') {
        throw new ComposeTasksError('job_cancelled', job.error ?? 'Запрос отменён');
      }
      if (job.status !== 'succeeded' || !job.improvedText) {
        throw new ComposeTasksError('timeout', 'AI диспетчер не ответил');
      }
      return parseComposeResult(job.improvedText);
    } catch (e) {
      throw toComposeError(e);
    }
  }

  // Ленивый pass-2: по сегментам из pass-1 считает только «Продвинутый» вариант (opus + полная
  // KB задетектированных проектов). Вызывается, когда пользователь открыл вкладку «Продвинутый».
  // Возвращает map id→advancedBody; недостающие сегменты UI оставит на simpleBody.
  async advance(input: {
    segments: ComposeAdvanceSegment[];
    projectId: string | null;
  }): Promise<ComposeAdvancedResult> {
    if (input.segments.length === 0) return {};
    // Сегменты едут JSON-строкой в поле text (сервер для compose-advanced допускает широкий payload).
    const payload = JSON.stringify({ segments: input.segments });

    let jobId: string;
    try {
      ({ jobId } = await this.repo.enqueue({
        text: payload,
        projectId: input.projectId,
        mode: 'compose-advanced',
      }));
    } catch (e) {
      throw toComposeError(e);
    }

    try {
      const deadline = Date.now() + MAX_TOTAL_MS;
      let job = await this.repo.waitFor(jobId, POLL_WAIT_SECONDS);
      while (!TERMINAL.has(job.status) && Date.now() < deadline) {
        job = await this.repo.waitFor(jobId, POLL_WAIT_SECONDS);
      }

      if (job.status === 'failed') {
        throw new ComposeTasksError('job_failed', job.error ?? 'AI не смог обработать запрос');
      }
      if (job.status === 'cancelled') {
        throw new ComposeTasksError('job_cancelled', job.error ?? 'Запрос отменён');
      }
      if (job.status !== 'succeeded' || !job.improvedText) {
        throw new ComposeTasksError('timeout', 'AI диспетчер не ответил');
      }
      return parseAdvancedResult(job.improvedText);
    } catch (e) {
      throw toComposeError(e);
    }
  }
}

function toComposeError(e: unknown): ComposeTasksError {
  if (e instanceof ComposeTasksError) return e;
  if (e instanceof ImproveTaskDescriptionError) {
    // Коды совпадают по смыслу (rate_limited / ai_not_configured / no_dispatcher_for_project / unknown).
    return new ComposeTasksError(e.code as ComposeTasksErrorCode, e.message);
  }
  return new ComposeTasksError('unknown', e instanceof Error ? e.message : String(e));
}

// Дедлайн: строгий YYYY-MM-DD + проверка реального календаря (источник — LLM, может
// выдать 2026-13-40). Невалидное → null, чтобы не утекало в DATE-колонку.
function validDeadline(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? v : null;
}

// Достаёт JSON-объект из ответа модели: устойчив к ```-обёрткам и тексту до/после JSON.
function extractJsonObject(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new ComposeTasksError('bad_result', 'AI вернул нераспознаваемый ответ');
  }
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new ComposeTasksError('bad_result', 'AI вернул нераспознаваемый ответ');
  }
}

// Разбор JSON-результата pass-2: { segments: [{ id, advancedBody }] } → map id→advancedBody.
export function parseAdvancedResult(raw: string): ComposeAdvancedResult {
  const obj = extractJsonObject(raw) as { segments?: unknown };
  if (!Array.isArray(obj.segments)) {
    throw new ComposeTasksError('bad_result', 'AI вернул ответ без сегментов');
  }
  const out: ComposeAdvancedResult = {};
  for (const rawSeg of obj.segments as unknown[]) {
    const o = (rawSeg ?? {}) as Record<string, unknown>;
    const id = typeof o['id'] === 'string' ? (o['id'] as string) : '';
    const advancedBody = typeof o['advancedBody'] === 'string' ? (o['advancedBody'] as string) : '';
    if (id && advancedBody) out[id] = advancedBody;
  }
  return out;
}

// Разбор JSON-результата compose: устойчив к ```-обёрткам и тексту вокруг JSON.
export function parseComposeResult(raw: string): ComposeResult {
  const obj = extractJsonObject(raw) as { version?: unknown; segments?: unknown };
  if (!obj || !Array.isArray(obj.segments)) {
    throw new ComposeTasksError('bad_result', 'AI вернул ответ без сегментов');
  }
  const rawSegments: unknown[] = obj.segments;
  const segments: ComposeSegment[] = rawSegments.map((rawSeg, i) => {
    const o = (rawSeg ?? {}) as Record<string, unknown>;
    const simpleBody = typeof o['simpleBody'] === 'string' ? (o['simpleBody'] as string) : '';
    const advancedBody =
      typeof o['advancedBody'] === 'string' && (o['advancedBody'] as string).length > 0
        ? (o['advancedBody'] as string)
        : simpleBody;
    return {
      id: typeof o['id'] === 'string' && o['id'] ? (o['id'] as string) : `s${i + 1}`,
      title: typeof o['title'] === 'string' ? (o['title'] as string) : '',
      simpleBody,
      advancedBody,
      projectId:
        typeof o['projectId'] === 'string' && o['projectId'] ? (o['projectId'] as string) : null,
      projectName:
        typeof o['projectName'] === 'string' && o['projectName']
          ? (o['projectName'] as string)
          : null,
      confidence: typeof o['confidence'] === 'number' ? (o['confidence'] as number) : 0,
      assigneeUserId:
        typeof o['assigneeUserId'] === 'string' && o['assigneeUserId']
          ? (o['assigneeUserId'] as string)
          : null,
      assigneeName:
        typeof o['assigneeName'] === 'string' && o['assigneeName']
          ? (o['assigneeName'] as string)
          : null,
      deadline: validDeadline(o['deadline']),
    };
  });
  if (segments.length === 0) {
    throw new ComposeTasksError('bad_result', 'AI вернул пустой список задач');
  }
  return { version: typeof obj.version === 'number' ? obj.version : 1, segments };
}
