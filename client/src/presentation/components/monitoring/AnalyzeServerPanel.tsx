import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import { relativeTime } from '@/lib/relativeTime';
import { HttpError } from '@/lib/HttpError';
import type { MonitoringAnalysisResult, MonitoringAnalysisType } from '@/domain/monitoring/Analysis';
import { CommentBody } from '@/presentation/components/tasks/CommentBody';

// 3 × 50с long-poll ≈ 150с — анализ через диспетчера (claude -p) обычно 15–60с.
const MAX_POLLS = 3;

const TYPE_LABEL: Record<MonitoringAnalysisType, string> = {
  snapshot: 'Снимок',
  logs: 'Логи',
  alert: 'Алерт',
  digest: 'Дайджест',
};

// Вкладка «AI» в детали сервера: запуск AI-разбора через диспетчера + история анализов.
export function AnalyzeServerPanel({
  projectId,
  serverId,
  canManage,
}: {
  projectId: string;
  serverId: string;
  canManage: boolean;
}): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const [history, setHistory] = useState<MonitoringAnalysisResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    monitoringRepository
      .listAnalysisHistory(projectId, serverId)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [monitoringRepository, projectId, serverId]);

  const reloadHistory = (): void => {
    monitoringRepository
      .listAnalysisHistory(projectId, serverId)
      .then(setHistory)
      .catch(() => {
        /* keep prev */
      });
  };

  const analyze = async (type: MonitoringAnalysisType): Promise<void> => {
    const reqId = ++reqIdRef.current;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await monitoringRepository.enqueueAnalysis(projectId, serverId, type);
      let res = await monitoringRepository.waitAnalysis(jobId);
      let polls = 0;
      while ((res.status === 'queued' || res.status === 'running') && polls < MAX_POLLS) {
        polls += 1;
        res = await monitoringRepository.waitAnalysis(jobId);
      }
      if (reqId !== reqIdRef.current) return;
      if (res.status === 'succeeded') {
        reloadHistory();
      } else if (res.status === 'failed') {
        setError(res.error ?? 'AI не смог проанализировать');
      } else if (res.status === 'cancelled') {
        setError('Анализ отменён');
      } else {
        setError('Диспетчер пока не ответил — попробуйте ещё раз через минуту');
      }
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      if (e instanceof HttpError) {
        if (e.status === 429) setError('Слишком много запросов на анализ. Подождите.');
        else if (e.status === 503) setError('У проекта не назначен диспетчер для AI');
        else setError(e.body?.message ?? e.body?.error ?? `HTTP ${e.status}`);
      } else {
        setError((e as Error).message);
      }
    } finally {
      if (reqId === reqIdRef.current) setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        AI-разбор метрик и логов через диспетчера: диагностика причины и рекомендации по одному клику.
      </p>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void analyze('snapshot')} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Разобрать снимок
          </Button>
          <Button variant="outline" size="sm" onClick={() => void analyze('logs')} disabled={busy}>
            <FileText className="size-4" />
            Разобрать логи
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Запуск анализа доступен участникам с правами редактора.</p>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Диспетчер анализирует… (15–60с)
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {history === null ? (
          <p className="text-sm text-muted-foreground">Загрузка истории…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Анализов пока нет.</p>
        ) : (
          history.map((a) => (
            <div key={a.jobId} className="rounded-md border border-border/60 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                <span className="font-medium text-foreground">{TYPE_LABEL[a.analysisType]}</span>
                <span>· {relativeTime(a.createdAt)}</span>
                {a.costUsd != null && <span>· ${a.costUsd.toFixed(2)}</span>}
                {a.status !== 'succeeded' && <span className="text-amber-600 dark:text-amber-400">· {a.status}</span>}
              </div>
              {a.status === 'succeeded' && a.resultMarkdown ? (
                <CommentBody body={a.resultMarkdown} />
              ) : (
                <p className="text-sm text-muted-foreground">{a.error ?? 'нет результата'}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
