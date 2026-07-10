import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CalendarClock, CircleDot, Clock, Flag, Loader2, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { useUpgradeDialog } from '@/presentation/usage/UpgradeDialogProvider';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import { PropertyRow } from './PropertyRow';
import { RalphModeBadge } from './RalphMode';
import { PriorityBadge } from './PriorityBadge';
import { DeadlineBadge } from './DeadlineBadge';
import { Markdown } from '@/presentation/components/markdown/Markdown';
import type { TaskStatus } from '@/domain/task/Task';
import type { TaskSnapshot, TaskVersionsResult } from '@/domain/task/TaskVersion';

// Цвета статус-пилюли — как в шапке задачи (зеркало STATUS_BADGE_COLOR из TaskDrawer),
// чтобы превью версии выглядело один-в-один со «своим» окном задачи.
const STATUS_BADGE_COLOR: Record<TaskStatus, string> = {
  backlog: 'bg-stone-500/15 text-stone-600 dark:bg-stone-500/20 dark:text-stone-300',
  manual: 'bg-yellow-500/15 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  todo: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  in_progress: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  awaiting_clarification: 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  done: 'bg-green-500/15 text-green-700 dark:bg-green-500/20 dark:text-green-400',
};

function fmtDateTime(d: Date): string {
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Пословный diff (LCS): что в newText добавилось/изменилось относительно oldText. Возвращает
// части нового текста с флагом added — их подсвечиваем синим («видно, что именно поменялось»).
type DiffPart = { readonly text: string; readonly added: boolean };
function wordDiff(oldText: string, newText: string): DiffPart[] {
  const a = oldText.split(/(\s+)/);
  const b = newText.split(/(\s+)/);
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (j < n) {
    if (i < m && a[i] === b[j]) {
      parts.push({ text: b[j]!, added: false });
      i++;
      j++;
    } else if (i < m && dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++; // слово было в старой версии, в новой нет — не показываем (мы рисуем НОВЫЙ текст)
    } else {
      parts.push({ text: b[j]!, added: true });
      j++;
    }
  }
  return parts;
}

// Текст с синей подсветкой добавленного/изменённого относительно предыдущей версии.
function DiffText({ oldText, newText }: { oldText: string; newText: string }): React.ReactElement {
  const parts = useMemo(() => wordDiff(oldText, newText), [oldText, newText]);
  return (
    <>
      {parts.map((p, idx) =>
        p.added ? (
          <span
            key={idx}
            className="rounded bg-blue-500/20 text-blue-700 dark:bg-blue-400/25 dark:text-blue-100"
          >
            {p.text}
          </span>
        ) : (
          <span key={idx}>{p.text}</span>
        ),
      )}
    </>
  );
}

// Обёртка значения свойства: синее кольцо, если оно изменилось относительно предыдущей версии.
function ChangedMark({ changed, children }: { changed: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <span className={cn('inline-flex items-center rounded', changed && 'ring-2 ring-blue-500/50 ring-offset-1 ring-offset-background')}>
      {children}
    </span>
  );
}

// Превью выбранной версии — как «своё» окно задачи. Если есть предыдущая версия (prev),
// подсвечиваем синим что именно поменялось: слова заголовка/тела (пословный diff) + кольцо
// вокруг изменённых свойств (статус/приоритет/срок/режим). У самой первой версии diff'а нет.
function VersionPreview({
  snapshot,
  prev,
}: {
  snapshot: TaskSnapshot;
  prev: TaskSnapshot | null;
}): React.ReactElement {
  const desc = snapshot.description ?? '';
  const nl = desc.indexOf('\n');
  const title = (nl === -1 ? desc : desc.slice(0, nl)).trim() || 'Без названия';
  const body = nl === -1 ? '' : desc.slice(nl + 1).trim();
  const status = snapshot.status as TaskStatus;

  const prevDesc = prev?.description ?? '';
  const prevNl = prevDesc.indexOf('\n');
  const prevTitle = (prevNl === -1 ? prevDesc : prevDesc.slice(0, prevNl)).trim();
  const prevBody = prevNl === -1 ? '' : prevDesc.slice(prevNl + 1).trim();

  return (
    <div className="mx-auto max-w-2xl">
      <h3 className="mb-4 text-[1.75rem] font-bold leading-tight tracking-tight">
        {prev ? <DiffText oldText={prevTitle} newText={title} /> : title}
      </h3>
      <div className="mb-2 space-y-0.5">
        <PropertyRow icon={CircleDot} label="Статус">
          <ChangedMark changed={!!prev && prev.status !== snapshot.status}>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                STATUS_BADGE_COLOR[status] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {STATUS_LABEL[status] ?? snapshot.status}
            </span>
          </ChangedMark>
        </PropertyRow>
        <PropertyRow icon={Flag} label="Приоритет">
          <ChangedMark changed={!!prev && prev.priority !== snapshot.priority}>
            {snapshot.priority != null ? (
              <PriorityBadge priority={snapshot.priority} />
            ) : (
              <span className="text-sm text-muted-foreground/70">Без приоритета</span>
            )}
          </ChangedMark>
        </PropertyRow>
        <PropertyRow icon={CalendarClock} label="Дедлайн">
          <ChangedMark changed={!!prev && prev.deadline !== snapshot.deadline}>
            {snapshot.deadline ? (
              <DeadlineBadge deadline={snapshot.deadline} status={status} />
            ) : (
              <span className="text-sm text-muted-foreground/70">Без срока</span>
            )}
          </ChangedMark>
        </PropertyRow>
        <PropertyRow icon={Bot} label="Режим">
          <ChangedMark changed={!!prev && prev.ralphMode !== snapshot.ralphMode}>
            <RalphModeBadge mode={snapshot.ralphMode} />
          </ChangedMark>
        </PropertyRow>
      </div>
      {(body || prevBody) && (
        <div className="border-t pt-3">
          {prev ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
              <DiffText oldText={prevBody} newText={body} />
            </p>
          ) : (
            <Markdown>{body}</Markdown>
          )}
        </div>
      )}
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
  // Версии отсортированы новыми-сверху → предыдущая версия выбранной = следующая в списке.
  const selectedIndex = data ? data.versions.findIndex((v) => v.id === selectedId) : -1;
  const prevSnapshot =
    data && selectedIndex >= 0 && selectedIndex + 1 < data.versions.length
      ? data.versions[selectedIndex + 1]!.snapshot
      : null;
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
      <DialogContent className="flex h-[88vh] w-[95vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        {/* Заголовок + основное действие справа сверху (как в Notion Version history):
            кнопка «Восстановить» здесь, а не внизу — pr-12 чтобы не залезть под крестик (right-4). */}
        <DialogHeader className="shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b px-5 py-3 pr-12">
          <DialogTitle>История версий</DialogTitle>
          <Button
            size="sm"
            disabled={!selected || restoring || (selected != null && isLocked(selected.createdAt))}
            onClick={() => void restore()}
          >
            {restoring ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />}
            Восстановить
          </Button>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          {/* Превью выбранной версии — просторная колонка с отступами, как в окне задачи. */}
          <div className="min-w-0 flex-1 overflow-y-auto px-8 py-8 sm:px-12">
            {loading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : selected ? (
              <VersionPreview snapshot={selected.snapshot} prev={prevSnapshot} />
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
