import type { SiteEditorAiJob } from '@/application/site-editor/SiteEditorRepository';
import { HttpError } from '@/lib/HttpError';

export class SiteEditorAiPollingTimeoutError extends Error {
  constructor() {
    super('Site editor AI job polling timed out');
    this.name = 'SiteEditorAiPollingTimeoutError';
  }
}

export class SiteEditorAiSubmissionCoordinator {
  private active: { readonly key: string; readonly controller: AbortController } | null = null;

  constructor(private readonly createKey: () => string = () => `preview-ai-${crypto.randomUUID()}`) {}

  start<T>(worker: (idempotencyKey: string, signal: AbortSignal) => Promise<T>):
    | { readonly accepted: false }
    | { readonly accepted: true; readonly idempotencyKey: string; readonly completion: Promise<T> } {
    if (this.active) return { accepted: false };

    const current = { key: this.createKey(), controller: new AbortController() };
    this.active = current;
    // The worker starts in a microtask. The click handler can therefore render its
    // acknowledgement before any network or polling work begins.
    const completion = Promise.resolve()
      .then(() => worker(current.key, current.controller.signal))
      .finally(() => {
        if (this.active === current) this.active = null;
      });
    return { accepted: true, idempotencyKey: current.key, completion };
  }

  cancel(): void {
    const current = this.active;
    this.active = null;
    current?.controller.abort();
  }
}

type PollOptions = {
  readonly signal: AbortSignal;
  readonly load: (jobId: string) => Promise<SiteEditorAiJob>;
  readonly onProgress: (job: SiteEditorAiJob) => void;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

function abortableWait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onDone = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(onDone, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollSiteEditorAiJob(initial: SiteEditorAiJob, options: PollOptions): Promise<SiteEditorAiJob> {
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  const wait = options.wait ?? abortableWait;
  let job = initial;
  options.onProgress(job);

  while (job.status === 'queued' || job.status === 'running') {
    if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() >= deadline) throw new SiteEditorAiPollingTimeoutError();
    await wait(options.intervalMs ?? 1_500, options.signal);
    job = await options.load(job.id);
    options.onProgress(job);
  }
  return job;
}

export function siteEditorAiErrorMessage(error: unknown): string {
  if (error instanceof SiteEditorAiPollingTimeoutError) {
    return 'Задача принята, но долго выполняется. Не отправляйте её повторно — результат появится после обработки.';
  }
  if (error instanceof HttpError) {
    if (error.body.error === 'dispatcher_not_configured') return 'Для проекта не настроен диспетчер. Сначала подключите воркер.';
    if (error.body.error === 'site_not_deployed') return 'Сначала запустите проект, чтобы ИИ мог изменить опубликованный результат.';
    if (error.body.error === 'artifact_conflict') return 'Результат проекта уже обновился. Перезагрузите Preview и повторите запрос.';
    if (error.body.error === 'site_editor_session_invalid') return 'Сессия редактирования истекла. Откройте режим Edit ещё раз.';
    if (error.body.message?.trim()) return error.body.message;
  }
  return 'Не удалось передать изменение ИИ. Проверьте соединение и попробуйте ещё раз.';
}
