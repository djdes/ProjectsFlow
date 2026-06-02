import { useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  Check,
  ChevronDown,
  FileText,
  FolderInput,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';
import { CommentBody } from '@/presentation/components/tasks/CommentBody';
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

const TAB_HINT: Record<TabKey, string> = {
  simple: 'Простыми словами и аккуратно — смысл без изменений.',
  advanced: 'Развёрнуто: цель → шаги → критерии, с учётом базы знаний проекта.',
};

// Круглый чек-индикатор выбора задачи: Radix Checkbox со скруглением в круг + заливкой
// primary. Заметно красивее дефолтного квадрата, сохраняет доступность/фокус.
function RoundCheck({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Checkbox>): React.ReactElement {
  return (
    <Checkbox
      className={cn(
        'size-5 rounded-full border-2 border-muted-foreground/35 bg-background shadow-none transition-all duration-200',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=unchecked]:hover:border-primary/60',
        '[&_svg]:size-3',
        className,
      )}
      {...props}
    />
  );
}

// Кнопка «AI» в композере: открывает диалог с ДВУМЯ вариантами переработки
// («Простой»/«Продвинутый») на вкладках, переключателем режима «в поле / по проектам»
// и списком-ревью для распределения разбитых задач по проектам.
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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

  const toggleExpand = (id: string): void =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const setInclude = (id: string, include: boolean): void =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, include } : r)));

  const start = async (): Promise<void> => {
    if (disabled || trimmed.length === 0) return;
    const reqId = ++reqIdRef.current;
    setResult(null);
    setErrorMsg('');
    setActiveTab('simple');
    setExpanded({});
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

  const headerTitle =
    phase === 'loading'
      ? 'AI готовит варианты…'
      : phase === 'creating'
        ? 'Создаём задачи…'
        : phase === 'error'
          ? 'AI не смог обработать'
          : 'Переработка текста';

  const headerHint =
    phase === 'preview'
      ? 'Сравни варианты — примени в поле или распредели по проектам.'
      : phase === 'creating'
        ? 'Создаём выбранные задачи…'
        : phase === 'error'
          ? 'Текст остался без изменений.'
          : 'Два варианта + разбивка по проектам. Это 1–2 минуты — можно отменить.';

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
        <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {/* HEADER — компактная sticky-шапка в одну смысловую строку */}
          <div className="flex shrink-0 items-start gap-2.5 border-b px-4 py-3 pr-12">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/10">
              <Sparkles className="size-3.5 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[15px] font-semibold leading-tight">
                {headerTitle}
              </DialogTitle>
              <DialogDescription className="mt-0.5 line-clamp-2 text-xs leading-snug">
                {headerHint}
              </DialogDescription>
            </div>
            {phase === 'creating' && progress && (
              <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                {progress.done}/{progress.total}
              </span>
            )}
            {phase === 'loading' && (
              <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-primary" />
            )}
          </div>

          {/* BODY — единственная скроллируемая область */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {phase === 'loading' || (phase === 'creating' && !result) ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
                <div className="relative">
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                  <span className="relative grid size-14 place-items-center rounded-full bg-primary/10">
                    <Sparkles className="size-7 animate-pulse text-primary" />
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground">Генерация двух вариантов…</p>
                <p className="text-xs">Обычно 1–2 минуты. Можно отменить.</p>
              </div>
            ) : phase === 'error' ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-destructive/10">
                  <X className="size-7 text-destructive" />
                </span>
                <p className="text-sm font-medium text-foreground">AI не смог обработать</p>
                <p className="max-w-sm text-xs text-muted-foreground">{errorMsg}</p>
              </div>
            ) : result ? (
              <>
                {/* Вкладки варианта + подсказка режима */}
                <div className="space-y-1.5">
                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="simple" className="gap-1.5">
                        <Wand2 className="size-3.5" />
                        Простой
                      </TabsTrigger>
                      <TabsTrigger value="advanced" className="gap-1.5">
                        <BrainCircuit className="size-3.5" />
                        Продвинутый
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <p className="px-0.5 text-xs text-muted-foreground">{TAB_HINT[activeTab]}</p>
                </div>

                {/* Переключатель режима — сегмент-контрол ВЫШЕ управляемой области */}
                {canDistribute && (
                  <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/50 p-1">
                    <button
                      type="button"
                      onClick={() => setDistribute(false)}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                        !distribute
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <FileText className="size-3.5" />
                      В одно поле
                    </button>
                    <button
                      type="button"
                      onClick={() => setDistribute(true)}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                        distribute
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <FolderInput className="size-3.5" />
                      По проектам
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                          distribute ? 'bg-primary/15 text-primary' : 'bg-muted-foreground/15',
                        )}
                      >
                        {includedCount}
                      </span>
                    </button>
                  </div>
                )}

                {/* Управляемая область */}
                {!distribute ? (
                  <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <CommentBody body={joinedDoc(activeTab)} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rows.map((row) => {
                      const seg = result.segments.find((s) => s.id === row.id);
                      if (!seg) return null;
                      const body = bodyFor(seg, activeTab);
                      const isLong = body.trim().length > 140;
                      const isOpen = !!expanded[row.id];
                      return (
                        <div
                          key={row.id}
                          className={cn(
                            'rounded-xl border p-2.5 transition-all duration-200',
                            row.include
                              ? 'border-primary/40 bg-primary/[0.04] shadow-sm'
                              : 'border-border bg-background opacity-60 hover:opacity-100',
                          )}
                        >
                          <div className="flex items-start gap-2.5">
                            <RoundCheck
                              checked={row.include}
                              onCheckedChange={(c) => setInclude(row.id, c === true)}
                              className="mt-1.5"
                              aria-label="Создавать эту задачу"
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <input
                                value={row.title}
                                onChange={(e) =>
                                  setRows((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, title: e.target.value } : r)),
                                  )
                                }
                                placeholder="Заголовок задачи"
                                className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold focus:border-input focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                              />

                              <div className="flex items-center gap-1.5 rounded-md border bg-background pl-2">
                                <FolderInput className="size-3.5 shrink-0 text-muted-foreground" />
                                <select
                                  value={row.projectId ?? INBOX_VALUE}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id
                                          ? {
                                              ...r,
                                              projectId:
                                                e.target.value === INBOX_VALUE ? null : e.target.value,
                                            }
                                          : r,
                                      ),
                                    )
                                  }
                                  className="min-w-0 flex-1 cursor-pointer rounded-md bg-transparent py-1 pr-1.5 text-xs focus:outline-none"
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

                              <div className="px-1.5">
                                {isOpen ? (
                                  <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-2">
                                    <CommentBody body={body} />
                                  </div>
                                ) : isLong ? (
                                  <div className="max-h-[3.25rem] overflow-hidden [-webkit-mask-image:linear-gradient(to_bottom,#000_55%,transparent)] [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]">
                                    <CommentBody body={body} />
                                  </div>
                                ) : (
                                  <CommentBody body={body} />
                                )}
                                {isLong && (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(row.id)}
                                    className="ml-1.5 mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                                  >
                                    <ChevronDown
                                      className={cn('size-3 transition-transform', isOpen && 'rotate-180')}
                                    />
                                    {isOpen ? 'Свернуть' : 'Показать полностью'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* FOOTER — sticky, действия зависят от фазы */}
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 border-t px-4 py-3',
              phase === 'preview' || phase === 'error' ? 'justify-between' : 'justify-end',
            )}
          >
            {phase === 'loading' && (
              <Button type="button" variant="ghost" onClick={dismiss} className="gap-1.5">
                <X className="size-4" />
                Отмена
              </Button>
            )}
            {phase === 'creating' && (
              <Button type="button" variant="ghost" disabled className="gap-1.5">
                <Loader2 className="size-4 animate-spin" />
                {progress ? `Создаём ${progress.done}/${progress.total}…` : 'Создаём…'}
              </Button>
            )}
            {phase === 'preview' && (
              <>
                <Button type="button" variant="ghost" onClick={dismiss}>
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Винительный падеж — основной CTA «Создать N задачу/задачи/задач».
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
