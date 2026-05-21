import { useContainer } from '@/infrastructure/di/container';
import type { AgentJob } from '@/domain/agentJob/AgentJob';
import { Bot } from 'lucide-react';
import { useState } from 'react';

type Props = {
  job: AgentJob;
  projectId: string;
  onChanged: () => void;
};

const STATUS_TEXT: Record<AgentJob['status'], string> = {
  queued: 'В очереди',
  running: 'Работает',
  succeeded: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено',
};

const STATUS_CLASS: Record<AgentJob['status'], string> = {
  queued: 'bg-slate-100 text-slate-700 border-slate-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  succeeded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200',
};

export function AgentJobBadge({ job, projectId, onChanged }: Props): React.ReactElement {
  const { cancelAgentJob } = useContainer();
  const [busy, setBusy] = useState(false);

  const canCancel = job.status === 'queued' || job.status === 'running';

  async function handleCancel(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await cancelAgentJob.execute(projectId, job.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${STATUS_CLASS[job.status]}`}
    >
      <Bot className="h-3 w-3" />
      <span>{STATUS_TEXT[job.status]}</span>
      {job.status === 'succeeded' && job.prUrl && (
        <a
          href={job.prUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="underline hover:text-emerald-900"
        >
          PR
        </a>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="ml-1 opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
          title="Отменить"
        >
          ✕
        </button>
      )}
    </div>
  );
}
