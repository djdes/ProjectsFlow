import { useMemo, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useProjects } from '@/presentation/hooks/useProjects';
import {
  ComposeTasksError,
  type ComposeResult,
  type ComposeSegment,
  type ComposeTasksErrorCode,
} from '@/application/ai/ComposeTasks';
import type { RalphMode } from '@/domain/task/Task';
import { cn } from '@/lib/utils';

type Props = {
  /** Текущий текст. Кнопка disabled пока пуст. */
  readonly text: string;
  /** projectId контекста (доска) или null (inbox/глобально). */
  readonly projectId: string | null;
  /** Применить выбранный вариант в поле (без распределения). */
  readonly onImproved: (improved: string) => void;
  /** Вызывается после успешного создания N задач (очистить композер/закрыть форму). */
  readonly onDistributed?: () => void;
  /** RalphMode для создаваемых при распределении задач (по умолчанию normal). */
  readonly ralphMode?: RalphMode;
  /** Внешний disabled (форма сохраняется). */
  readonly disabled?: boolean;
  /** Компактная кнопка (для композера). */
  readonly compact?: boolean;
};

type Phase = 'idle' | 'loading' | 'preview' | 'error' | 'creating';
type TabKey = 'simple' | 'advanced';

// Строка ревью = одна будущая задача (редактируемая перед созданием).
type Row = {
  readonly id: string;
  title: string;
  projectId: string | null;
  include: boolean;
};

const INBOX_VALUE = '__inbox__';

// Кнопка «AI» в композере: вместо одного результата открывает диалог с ДВУМЯ вариантами
// переработки («Простой»/«Продвинутый») на вкладках и опциональным распределением
// разбитых задач по проектам (чекбокс → список-ревью → создание).
export function AiComposeDialog({
  text,
  projectId,
  onImproved,
  onDistributed,
  ralphMode = 'normal',
  disabled,
  compact,
}: Props): React.ReactElement {
  const { composeTasks, taskRepository, projectRepository } = useContainer();
  const { data: projects } = useProjects();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('simple');
  const [distribute, setDistribute] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Монотонный счётчик: «Отмена»/закрытие инкрементит → поздний результат отбрасывается.
  const reqIdRef = useRef(0);

  const realProjects = useMemo(() => (projects ?? []).filter((p) => !p.isInbox), [projects]);

  const trimmed = text.trim();
  const isBusy = phase === 'loading' || phase === 'creating';
  const isDisabled = disabled || isBusy || trimmed.length === 0;

  const canDistribute =
    !!result && (result.segments.length >= 2 || result.segments.some((s) => s.projectId !== null));

  const start = async (): Promise<void> => {
    if (disabled || trimmed.length === 0) return;
    const reqId = ++reqIdRef.current;
    setResult(null);
    setErrorMsg('');
    setActiveTab('simple');
    setProgress(null);
    setPhase('loading');
    try {
      const res = await composeTasks.execute({ text: trimmed, projectId });
      if (reqId !== reqIdRef.current) return;
      setResult(res);
      setRows(
        res.segments.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: s.projectId,
          include: true,
        })),
      );
      // Распределение по умолчанию включаем, когда оно осмысленно (мультипроект / явная привязка).
      setDistribute(res.segments.length >= 2 || res.segments.some((s) => s.projectId !== null));
      setPhase('preview');
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      const code = err instanceof ComposeTasksError ? err.code : 'unknown';
      const detail = err instanceof Error && err.message && err.message !== code ? err.message : '';
      setErrorMsg(detail || messageFor(code));
      setPhase('error');
    }
  };

  const dismiss = (): void => {
    reqIdRef.current += 1;
    setPhase('idle');
  };

  const bodyFor = (seg: ComposeSegment, tab: TabKey): string =>
    tab === 'simple' ? seg.simpleBody : seg.advancedBody;

  // Склейка выбранного варианта в один документ (для «Применить» без распределения).
  const joinedDoc = (tab: TabKey): string => {
    if (!result) return '';
    const multi = result.segments.length > 1;
    return result.segments
      .map((s) => {
        const body = bodyFor(s, tab);
        return multi && s.title ? `## ${s.title}\n\n${body}` : body;
      })
      .join('\n\n')
      .trim();
  };

  const apply = (): void => {
    onImproved(joinedDoc(activeTab));
    setPhase('idle');
  };

  const includedCount = rows.filter((r) => r.include).length;

  const createTasks = async (): Promise<void> => {
    if (!result) return;
    const included = rows.filter((r) => r.include);
    if (included.length === 0) return;
    setPhase('creating');

    let inboxId: string | null = null;
    if (included.some((r) => r.projectId === null)) {
      try {
        inboxId = (await projectRepository.getInbox()).id;
      } catch (e) {
        toast.error(`Не удалось получить «Входящие»: ${(e as Error).message}`);
        setPhase('preview');
        return;
      }
    }

    let ok = 0;
    setProgress({ done: 0, total: included.length });
    for (const r of included) {
      const seg = result.segments.find((s) => s.id === r.id);
      if (!seg) continue;
      const body = bodyFor(seg, activeTab);
      const title = r.title.trim();
      const description = title ? `**${title}**\n\n${body}` : body;
      const targetId = r.projectId ?? inboxId!;
      try {
        await taskRepository.create(targetId, { description, status: 'todo', ralphMode });
        ok += 1;
      } catch (e) {
        toast.error(`Не удалось создать «${title || 'задача'}»: ${(e as Error).message}`);
      }
      setProgress({ done: ok, total: included.length });
    }

    if (ok > 0) {
      toast.success(ok === included.length ? `Создано задач: ${ok}` : `Создано ${ok} из ${included.length}`);
    }
    onDistributed?.();
    setPhase('idle');
  };

  const title =
    phase === 'loading'
      ? 'AI готовит варианты…'
      : phase === 'creating'
        ? 'Создаём задачи…'
        : phase === 'error'
          ? 'AI не смог обработать'
          : 'Переработка текста';

  const subtitle =
    phase === 'loading'
      ? 'Два варианта + разбивка по проектам. Это занимает до 1–2 минут — можно отменить.'
      : phase === 'error'
        ? 'Текст остался без изменений.'
        : phase === 'creating'
          ? progress
            ? `Создано ${progress.done} из ${progress.total}…`
            : 'Создаём…'
          : 'Сравни «Простой» и «Продвинутый». Можно применить один вариант в поле или распределить задачи по проектам.';

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void start()}
        disabled={isDisabled}
        title="Переработать текст с помощью AI"
        className={cn('gap-1.5', compact ? 'h-10 px-2.5 text-xs' : 'h-8')}
      >
        {phase === 'loading' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        AI
      </Button>

      <Dialog
        open={phase !== 'idle'}
        onOpenChange={(open) => {
          if (!open && phase !== 'creating') dismiss();
        }}
      >
        <DialogContent className="flex max-h-[88dvh] flex-col gap-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <Sparkles className="size-4 shrink-0 text-primary" />
              {title}
            </DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>

          {phase === 'error' ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMsg}
            </p>
          ) : phase === 'loading' || (phase === 'creating' && !result) ? (
            <div className="flex min-h-[12rem] items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Генерация…
            </div>
          ) : result ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
                <TabsList>
                  <TabsTrigger value="simple">Простой</TabsTrigger>
                  <TabsTrigger value="advanced">Продвинутый</TabsTrigger>
                </TabsList>
              </Tabs>

              {!distribute ? (
                <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-sm max-sm:max-h-64 sm:min-h-[14rem]">
                  {joinedDoc(activeTab)}
                </div>
              ) : (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-2 max-sm:max-h-72 sm:min-h-[14rem]">
                  {rows.map((row) => {
                    const seg = result.segments.find((s) => s.id === row.id);
                    if (!seg) return null;
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          'rounded-md border bg-background p-2 transition-opacity',
                          row.include ? '' : 'opacity-50',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={row.include}
                            onCheckedChange={(c) =>
                              setRows((prev) =>
                                prev.map((r) => (r.id === row.id ? { ...r, include: c === true } : r)),
                              )
                            }
                            aria-label="Создавать эту задачу"
                          />
                          <input
                            value={row.title}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r) => (r.id === row.id ? { ...r, title: e.target.value } : r)),
                              )
                            }
                            placeholder="Заголовок задачи"
                            className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <select
                            value={row.projectId ?? INBOX_VALUE}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id
                                    ? { ...r, projectId: e.target.value === INBOX_VALUE ? null : e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="max-w-[40%] shrink-0 rounded border bg-background px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            title="Проект назначения"
                          >
                            <option value={INBOX_VALUE}>Без проекта (Входящие)</option>
                            {realProjects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words pl-6 text-xs text-muted-foreground">
                          {bodyFor(seg, activeTab)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {canDistribute && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={distribute}
                    onCheckedChange={(c) => setDistribute(c === true)}
                    disabled={phase === 'creating'}
                  />
                  Распределить по проектам — {includedCount}{' '}
                  {pluralTasks(includedCount)}
                </label>
              )}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            {phase === 'loading' && (
              <Button type="button" variant="ghost" onClick={dismiss}>
                Отмена
              </Button>
            )}
            {phase === 'creating' && (
              <Button type="button" variant="ghost" disabled>
                <Loader2 className="mr-1.5 size-4 animate-spin" />
                Создаём…
              </Button>
            )}
            {phase === 'preview' && (
              <>
                <Button type="button" variant="ghost" onClick={dismiss} className="gap-1.5">
                  <X className="size-4" />
                  Отмена
                </Button>
                {distribute ? (
                  <Button
                    type="button"
                    onClick={() => void createTasks()}
                    disabled={includedCount === 0}
                    className="gap-1.5"
                  >
                    <Check className="size-4" />
                    Создать {includedCount} {pluralTasks(includedCount)}
                  </Button>
                ) : (
                  <Button type="button" onClick={apply} className="gap-1.5">
                    <Check className="size-4" />
                    Применить
                  </Button>
                )}
              </>
            )}
            {phase === 'error' && (
              <>
                <Button type="button" variant="ghost" onClick={dismiss}>
                  Закрыть
                </Button>
                <Button type="button" onClick={() => void start()}>
                  Повторить
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'задачу';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'задачи';
  return 'задач';
}

function messageFor(code: ComposeTasksErrorCode): string {
  switch (code) {
    case 'timeout':
      return 'AI не ответил вовремя — попробуй ещё раз';
    case 'ai_not_configured':
      return 'AI не настроен. Обратись к админу.';
    case 'no_dispatcher_for_project':
      return 'У проекта не назначен диспетчер для AI';
    case 'rate_limited':
      return 'Слишком много AI-запросов. Подожди минуту.';
    case 'job_failed':
      return 'AI не смог обработать запрос';
    case 'job_cancelled':
      return 'AI-запрос отменён';
    case 'bad_result':
      return 'AI вернул нераспознаваемый ответ — попробуй ещё раз';
    default:
      return 'Не удалось переработать текст';
  }
}
