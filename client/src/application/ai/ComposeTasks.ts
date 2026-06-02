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
};

export type ComposeResult = {
  readonly version: number;
  readonly segments: ComposeSegment[];
};

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

// compose тяжелее improve: 2 прохода opus + сбор KB. Один long-poll сервера ограничен
// 60с (HARD_MAX_WAIT_MS), поэтому опрашиваем циклом до ~3 минут суммарно.
const POLL_WAIT_SECONDS = 55;
const MAX_TOTAL_MS = 180_000;

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
}

function toComposeError(e: unknown): ComposeTasksError {
  if (e instanceof ComposeTasksError) return e;
  if (e instanceof ImproveTaskDescriptionError) {
    // Коды совпадают по смыслу (rate_limited / ai_not_configured / no_dispatcher_for_project / unknown).
    return new ComposeTasksError(e.code as ComposeTasksErrorCode, e.message);
  }
  return new ComposeTasksError('unknown', e instanceof Error ? e.message : String(e));
}

// Разбор JSON-результата compose: устойчив к ```-обёрткам и тексту вокруг JSON.
export function parseComposeResult(raw: string): ComposeResult {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new ComposeTasksError('bad_result', 'AI вернул нераспознаваемый ответ');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new ComposeTasksError('bad_result', 'AI вернул нераспознаваемый ответ');
  }
  const obj = parsed as { version?: unknown; segments?: unknown };
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
    };
  });
  if (segments.length === 0) {
    throw new ComposeTasksError('bad_result', 'AI вернул пустой список задач');
  }
  return { version: typeof obj.version === 'number' ? obj.version : 1, segments };
}
