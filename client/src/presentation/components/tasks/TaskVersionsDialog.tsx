import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { useUpgradeDialog } from '@/presentation/usage/UpgradeDialogProvider';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import type { TaskStatus } from '@/domain/task/Task';
import type { TaskSnapshot, TaskVersionsResult } from '@/domain/task/TaskVersion';

const PRIORITY_LABEL: Record<number, string> = { 1: 'Срочный', 2: 'Высокий', 3: 'Средний', 4: 'Низкий' };

function fmtDateTime(d: Date): string {
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Превью выбранной версии: заголовок (1-я строка описания) + свойства + тело.
function VersionPreview({ snapshot }: { snapshot: TaskSnapshot }): React.ReactElement {
  const desc = snapshot.description ?? '';
  const nl = desc.indexOf('\n');
  const title = (nl === -1 ? desc : desc.slice(0, nl)).trim() || 'Без названия';
  const body = nl === -1 ? '' : desc.slice(nl + 1).trim();
  const rows: Array<[string, string]> = [
    ['Статус', STATUS_LABEL[snapshot.status as TaskStatus] ?? snapshot.status],
    ['Приоритет', snapshot.priority != null ? (PRIORITY_LABEL[snapshot.priority] ?? String(snapshot.priority)) : '—'],
    ['Дедлайн', snapshot.deadline ?? '—'],
    ['Режим', snapshot.ralphMode],
  ];
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold">{title}</h3>
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 text-sm">
            <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 flex-1">{v}</dd>
          </div>
        ))}
      </dl>
      {body && <p className="whitespace-pre-wrap border-t pt-3 text-sm leading-relaxed">{body}</p>}
    </div>
  );
}

// Окно версий задачи (как в Notion Version history): слева — превью выбранной версии,
// справа — список версий за всё время; кнопка «Восстановить» возвращает ВСЮ задачу к версии.
// Версии старше 7 дней на бесплатном тарифе заблокированы (нужен Прайм/ВИП).
export function TaskVersionsDialog({
  projectId,
  taskId,
  open,
  onOpenChange,
}: {
  projectId: string;
  taskId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const upgrade = useUpgradeDialog();
  const [data, setData] = useState<TaskVersionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    setSelectedId(null);
    taskRepository
      .getVersions(projectId, taskId)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setSelectedId(r.versions[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setData({ versions: [], plan: 'free', cutoffAt: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, taskId, taskRepository]);

  const isLocked = useCallback(
    (createdAt: Date): boolean => !!data?.cutoffAt && createdAt.getTime() < data.cutoffAt.getTime(),
    [data],
  );
  const selected = data?.versions.find((v) => v.id === selectedId) ?? null;
  const hasLocked = !!data && data.versions.some((v) => isLocked(v.createdAt));

  const restore = async (): Promise<void> => {
    if (!selected || restoring || isLocked(selected.createdAt)) return;
    setRestoring(true);
    try {
      await taskRepository.restoreVersion(projectId, taskId, selected.id);
      toast.success('Задача восстановлена к выбранной версии');
      onOpenChange(false);
    } catch {
      toast.error('Не удалось восстановить версию');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle>История версий</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          {/* Превью выбранной версии */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : selected ? (
              <VersionPreview snapshot={selected.snapshot} />
            ) : (
              <p className="py-10 text-sm text-muted-foreground">Версий пока нет.</p>
            )}
          </div>
          {/* Список версий */}
          <div className="flex w-72 shrink-0 flex-col border-l">
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {(data?.versions ?? []).map((v) => {
                const locked = isLocked(v.createdAt);
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setSelectedId(v.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        locked
                          ? 'cursor-not-allowed text-muted-foreground/60'
                          : 'hover:bg-accent',
                        v.id === selectedId && !locked && 'bg-accent font-medium',
                      )}
                    >
                      <span className="truncate">{fmtDateTime(v.createdAt)}</span>
                      {locked && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* Гейтинг: старше 7 дней — Прайм/ВИП */}
            {hasLocked && (
              <div className="border-t p-3 text-center text-xs text-muted-foreground">
                <p className="mb-2">История 7 дней. Версии старше — на тарифе Прайм или ВИП.</p>
                <Button variant="outline" size="sm" className="w-full" onClick={() => upgrade.open()}>
                  Улучшить план
                </Button>
              </div>
            )}
            <div className="flex shrink-0 justify-end border-t p-3">
              <Button
                size="sm"
                disabled={!selected || restoring || (selected != null && isLocked(selected.createdAt))}
                onClick={() => void restore()}
              >
                {restoring && <Loader2 className="size-4 animate-spin" />}
                <Clock className="size-4" />
                Восстановить
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
