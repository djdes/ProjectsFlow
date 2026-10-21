import type { WorkerResult, WorkerResultStatus } from '@/domain/live/WorkerResult';
import { CommentBody } from './CommentBody';

const RESULT_STYLE: Record<WorkerResultStatus, { label: string; className: string }> = {
  done: { label: 'Работа завершена', className: 'bg-done-soft text-done-ink' },
  pending_approval: { label: 'На утверждении', className: 'bg-approval-soft text-approval-ink' },
  blocked: { label: 'Нужно вмешательство', className: 'bg-manual-soft text-manual-ink' },
  error: { label: 'Ошибка выполнения', className: 'bg-destructive-soft text-destructive' },
  awaiting_clarification: { label: 'Нужно уточнение', className: 'bg-approval-soft text-approval-ink' },
  canceled: { label: 'Работа отменена', className: 'bg-muted text-muted-foreground' },
  timeout: { label: 'Время ожидания истекло', className: 'bg-manual-soft text-manual-ink' },
};

export function WorkerResultMessage({ result }: { result: WorkerResult }): React.ReactElement {
  const appearance = RESULT_STYLE[result.status];
  return (
    <section data-worker-result={result.status} aria-label={appearance.label}
      className={`min-w-0 rounded-md px-3 py-2.5 ${appearance.className}`}>
      <p className="mbe-1 text-xs font-semibold">{appearance.label}</p>
      <CommentBody body={result.summary} className="text-sm leading-relaxed text-foreground" />
    </section>
  );
}
