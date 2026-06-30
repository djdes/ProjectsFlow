import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  Check,
  ChevronDown,
  FileText,
  FolderInput,
  Loader2,
  Sparkles,
  UserRound,
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
import { DeadlinePicker } from '@/presentation/components/tasks/DeadlinePicker';
import { useContainer } from '@/infrastructure/di/container';
import { useProjects } from '@/presentation/hooks/useProjects';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useAiBlocked } from '@/presentation/usage/useAiBlocked';
import {
  ComposeTasksError,
  type ComposeAdvanceSegment,
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
  /** Триггер — только иконка (квадратная), в стиле кластера действий окна задачи. */
  readonly iconOnly?: boolean;
  /** Доп. классы на icon-only триггер (например, размер size-7). */
  readonly className?: string;
  /**
   * Контекст правки существующей задачи. Если задан — режим «По проектам» обновляет
   * ЭТУ задачу для сегмента её проекта (без дубля), остальные проекты → новые задачи;
   * текущая задача НИКОГДА не удаляется.
   */
  readonly editTask?: { readonly projectId: string; readonly taskId: string };
};

type Phase = 'idle' | 'loading' | 'preview' | 'error' | 'creating';
type TabKey = 'simple' | 'advanced';

// Строка ревью = одна будущая задача (редактируемая перед созданием).
type Row = {
  readonly id: string;
  title: string;
  projectId: string | null;
  include: boolean;
  // Исполнитель (делегат), резолвнутый AI или выбранный вручную; null = без исполнителя.
  assigneeUserId: string | null;
  // Сырое имя из текста — подсказка, когда assigneeUserId не сматчился.
  assigneeName: string | null;
  // Дедлайн 'YYYY-MM-DD' или null.
  deadline: string | null;
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

type DelegateOption = { userId: string; displayName: string };

// Презентационный селект исполнителя для строки распределения. Список участников
// (editor+ без себя / shared-members для inbox) грузит и валидирует родитель
// (нужно для проверки перед созданием). options === undefined → ещё грузится.
// Пустой пункт показывает подсказку с именем, когда AI назвал исполнителя, но id
// не сматчился (или его сменили).
function RowAssigneeSelect({
  options,
  value,
  hintName,
  disabled,
  onChange,
  className,
}: {
  options: DelegateOption[] | undefined;
  value: string | null;
  hintName: string | null;
  disabled?: boolean;
  onChange: (userId: string | null) => void;
  className?: string;
}): React.ReactElement {
  const opts = options ?? [];
  const inList = opts.some((o) => o.userId === value);
  const showHint = !value && !!hintName;

  return (
    <div
      className={cn('flex items-center gap-1.5 rounded-md border bg-background pl-2', className)}
      title="Исполнитель (делегировать)"
    >
      <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
      <select
        value={value ?? ''}
        disabled={disabled || options === undefined}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 flex-1 cursor-pointer rounded-md bg-transparent py-1 pr-1.5 text-xs focus:outline-none disabled:opacity-60"
      >
        <option value="">
          {showHint ? `Без исполнителя — AI предлагал «${hintName}»` : 'Без исполнителя'}
        </option>
        {/* value от AI, но его нет в списке (сменили проект/устарело) — не теряем выбор. */}
        {value && !inList && <option value={value}>{hintName ?? 'Выбранный участник'}</option>}
        {opts.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

// Кнопка «AI» в композере: открывает диалог с ДВУМЯ вариантами переработки
// («Простой»/«Продвинутый») на вкладках, переключателем режима «в поле / распределить»
// и списком-ревью для распределения разбитых задач по проектам/исполнителям/срокам.
export function AiComposeDialog({
  text,
  projectId,
  onImproved,
  onDistributed,
  ralphMode = 'normal',
  disabled,
  compact,
  iconOnly,
  className,
  editTask,
}: Props): React.ReactElement {
  const { composeTasks, taskRepository, projectRepository } = useContainer();
  const { data: projects } = useProjects();
  const [phase, setPhase] = useState<Phase>('idle');
  // Секунды ожидания в фазе loading — для прогресса при долгой обработке (>60с).
  const [elapsedSec, setElapsedSec] = useState(0);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('simple');
  const [distribute, setDistribute] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Монотонный счётчик: «Отмена»/закрытие инкрементит → поздний результат отбрасывается.
  const reqIdRef = useRef(0);
  // Ленивый pass-2 («Продвинутый»): грузится при первом открытии вкладки. idle→loading→ready|error.
  const [advancedPhase, setAdvancedPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [advancedById, setAdvancedById] = useState<Record<string, string>>({});
  const [advancedErr, setAdvancedErr] = useState('');
  const advReqRef = useRef(0);
  const { user: me } = useCurrentUser();
  const meId = me?.id;
  // Кэш eligible-участников по ключу проекта (projectId | INBOX_VALUE). undefined = не загружено.
  // Нужен и для дропдаунов строк, и для валидации исполнителя ПЕРЕД созданием.
  const [membersByKey, setMembersByKey] = useState<Record<string, DelegateOption[] | undefined>>({});
  const loadingKeysRef = useRef<Set<string>>(new Set());

  const realProjects = useMemo(() => (projects ?? []).filter((p) => !p.isInbox), [projects]);

  // Лениво подгружаем eligible-участников проектов всех строк, пока показываем распределение.
  useEffect(() => {
    if (phase !== 'preview' || !distribute) return;
    const keys = Array.from(new Set(rows.map((r) => r.projectId ?? INBOX_VALUE)));
    for (const key of keys) {
      if (membersByKey[key] !== undefined || loadingKeysRef.current.has(key)) continue;
      loadingKeysRef.current.add(key);
      const load =
        key === INBOX_VALUE
          ? projectRepository
              .listSharedMembers()
              .then((list) => list.map((m) => ({ userId: m.id, displayName: m.displayName })))
          : projectRepository.listMembers(key).then((list) =>
              list
                .filter((m) => (m.role === 'editor' || m.role === 'owner') && m.userId !== meId)
                .map((m) => ({ userId: m.userId, displayName: m.user.displayName })),
            );
      load
        .then((opts) => setMembersByKey((p) => ({ ...p, [key]: opts })))
        .catch(() => setMembersByKey((p) => ({ ...p, [key]: [] })))
        .finally(() => loadingKeysRef.current.delete(key));
    }
  }, [phase, distribute, rows, membersByKey, projectRepository, meId]);

  const trimmed = text.trim();
  // Тикаем счётчик ожидания только в фазе loading; сбрасываем при выходе из неё.
  useEffect(() => {
    if (phase !== 'loading') {
      setElapsedSec(0);
      return;
    }
    setElapsedSec(0);
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Лимит подписки исчерпан → блокируем перефразировку (бэкенд всё равно вернёт 402).
  const { blocked: aiBlocked, reason: aiBlockedReason } = useAiBlocked();
  const isBusy = phase === 'loading' || phase === 'creating';
  const isDisabled = disabled || isBusy || trimmed.length === 0 || aiBlocked;

  const canDistribute =
    !!result && (result.segments.length >= 2 || result.segments.some((s) => s.projectId !== null));

  const toggleExpand = (id: string): void =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const setInclude = (id: string, include: boolean): void =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, include } : r)));

  const start = async (): Promise<void> => {
    if (disabled || trimmed.length === 0) return;
    const reqId = ++reqIdRef.current;
    advReqRef.current += 1; // отменяем возможный in-flight pass-2 от прошлого запуска
    setResult(null);
    setErrorMsg('');
    setActiveTab('simple');
    setExpanded({});
    setProgress(null);
    setAdvancedPhase('idle');
    setAdvancedById({});
    setAdvancedErr('');
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
          assigneeUserId: s.assigneeUserId,
          assigneeName: s.assigneeName,
          deadline: s.deadline,
        })),
      );
      // Распределение по умолчанию включаем, когда оно осмысленно. В режиме правки
      // «осмысленно» = AI предложил ДРУГОЙ проект (сигнал «относится к другому»);
      // привязка к текущему проекту — это просто «применить на месте».
      const suggestsOtherProject = editTask
        ? res.segments.some((s) => s.projectId !== null && s.projectId !== editTask.projectId)
        : res.segments.some((s) => s.projectId !== null);
      setDistribute(res.segments.length >= 2 || suggestsOtherProject);
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
    advReqRef.current += 1; // закрытие диалога инвалидирует in-flight pass-2
    setPhase('idle');
  };

  // Запускает ленивый pass-2 по ТЕКУЩИМ строкам (учитывает правки проекта/заголовка).
  const loadAdvanced = async (): Promise<void> => {
    if (!result) return;
    const reqId = ++advReqRef.current;
    setAdvancedErr('');
    setAdvancedPhase('loading');
    const segments: ComposeAdvanceSegment[] = result.segments.map((s) => {
      const row = rows.find((r) => r.id === s.id);
      const segProjectId = row ? row.projectId : s.projectId;
      const segProjectName = segProjectId
        ? (realProjects.find((p) => p.id === segProjectId)?.name ?? s.projectName)
        : null;
      return {
        id: s.id,
        title: (row?.title ?? s.title).trim(),
        simpleBody: s.simpleBody,
        projectId: segProjectId,
        projectName: segProjectName,
      };
    });
    try {
      const map = await composeTasks.advance({ segments, projectId });
      if (reqId !== advReqRef.current) return;
      setAdvancedById(map);
      setAdvancedPhase('ready');
    } catch (err) {
      if (reqId !== advReqRef.current) return;
      const code = err instanceof ComposeTasksError ? err.code : 'unknown';
      const detail = err instanceof Error && err.message && err.message !== code ? err.message : '';
      setAdvancedErr(detail || messageFor(code));
      setAdvancedPhase('error');
    }
  };

  // Переключение вкладки: открытие «Продвинутый» впервые лениво запускает pass-2.
  const onTabChange = (v: string): void => {
    const tab = v as TabKey;
    setActiveTab(tab);
    if (tab === 'advanced' && advancedPhase === 'idle') void loadAdvanced();
  };

  // «Простой» — всегда из pass-1; «Продвинутый» — из загруженного pass-2, иначе фолбэк на simple.
  const bodyFor = (seg: ComposeSegment, tab: TabKey): string =>
    tab === 'simple' ? seg.simpleBody : (advancedById[seg.id] ?? seg.simpleBody);

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

    // edit-aware: ПЕРВАЯ включённая строка, чей проект совпадает с текущей задачей,
    // ОБНОВЛЯЕТ её (без дубля). Остальные — создаются как новые. Текущую не удаляем.
    let currentUpdated = false;

    let ok = 0;
    let droppedAssignees = 0;
    setProgress({ done: 0, total: included.length });
    for (const r of included) {
      const seg = result.segments.find((s) => s.id === r.id);
      if (!seg) continue;
      const body = bodyFor(seg, activeTab);
      const title = r.title.trim();
      const description = title ? `**${title}**\n\n${body}` : body;
      const targetId = r.projectId ?? inboxId!;
      const updatesCurrent = !!editTask && !currentUpdated && targetId === editTask.projectId;
      // Делегируем только когда исполнитель реально в eligible-списке проекта. Иначе сервер
      // создаст задачу, но завалит делегирование (orphan + дубль при повторе). Если участники
      // ещё не догрузились (undefined) — доверяем AI (он брал id из того же eligible-контекста).
      const eligible = membersByKey[r.projectId ?? INBOX_VALUE];
      const validAssignee =
        r.assigneeUserId == null
          ? null
          : eligible === undefined || eligible.some((o) => o.userId === r.assigneeUserId)
            ? r.assigneeUserId
            : null;
      if (r.assigneeUserId != null && validAssignee == null) droppedAssignees += 1;
      try {
        if (updatesCurrent) {
          await taskRepository.update(editTask!.projectId, editTask!.taskId, {
            description,
            // null дедлайн = не трогаем существующий (undefined), а не очищаем.
            deadline: r.deadline ?? undefined,
          });
          // Делегирование существующей задачи — отдельным вызовом (update его не умеет).
          if (validAssignee) {
            try {
              await taskRepository.delegate(editTask!.projectId, editTask!.taskId, validAssignee);
            } catch (de) {
              // Не валим распределение, но честно сообщаем (напр. задача уже делегирована).
              toast.error(`Исполнитель не назначен: ${(de as Error).message}`);
            }
          }
          currentUpdated = true;
        } else {
          await taskRepository.create(targetId, {
            description,
            status: 'todo',
            ralphMode,
            delegateUserId: validAssignee ?? undefined,
            deadline: r.deadline ?? undefined,
          });
        }
        ok += 1;
      } catch (e) {
        const verb = updatesCurrent ? 'обновить' : 'создать';
        toast.error(`Не удалось ${verb} «${title || 'задача'}»: ${(e as Error).message}`);
      }
      setProgress({ done: ok, total: included.length });
    }
    if (droppedAssignees > 0) {
      toast.error(
        `Исполнитель не определён для задач: ${droppedAssignees} — назначьте вручную в карточке.`,
      );
    }

    if (ok > 0) {
      if (currentUpdated) {
        const created = ok - 1;
        toast.success(
          created > 0 ? `Задача обновлена, создано ещё: ${created}` : 'Задача обновлена',
        );
      } else if (editTask) {
        // Правка, но ни один сегмент не привязан к текущему проекту — её не трогали.
        toast.success(`Создано задач: ${ok}. Текущая задача не изменена.`);
      } else {
        toast.success(
          ok === included.length ? `Создано задач: ${ok}` : `Создано ${ok} из ${included.length}`,
        );
      }
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
      ? 'Сравни варианты — примени в поле или распредели по проектам, исполнителям и срокам.'
      : phase === 'creating'
        ? 'Создаём выбранные задачи…'
        : phase === 'error'
          ? 'Текст остался без изменений.'
          : 'Два варианта + разбивка по проектам. Это 1–2 минуты — можно отменить.';

  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={isDisabled}
          title={aiBlocked ? (aiBlockedReason ?? 'Лимит исчерпан') : 'Переработать текст с помощью AI'}
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40',
            className,
          )}
        >
          {phase === 'loading' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void start()}
          disabled={isDisabled}
          title={aiBlocked ? (aiBlockedReason ?? 'Лимит исчерпан') : 'Переработать текст с помощью AI'}
          className={cn('gap-1.5', compact ? 'h-8 px-2.5 text-xs' : 'h-8')}
        >
          {phase === 'loading' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          AI
        </Button>
      )}

      <Dialog
        open={phase !== 'idle'}
        onOpenChange={(open) => {
          if (!open && phase !== 'creating') dismiss();
        }}
      >
        <DialogContent className="flex flex-col gap-0 overflow-hidden rounded-none p-0 max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-full max-sm:max-w-none sm:max-h-[88dvh] sm:max-w-3xl sm:rounded-lg">
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
                {phase === 'loading' && elapsedSec >= 60 ? (
                  <p className="text-xs">
                    Большой промпт — обрабатываю, это может занять несколько минут. Не закрывайте
                    окно. ({elapsedSec} с)
                  </p>
                ) : (
                  <p className="text-xs">Обычно 1–2 минуты. Можно отменить.</p>
                )}
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
                  <Tabs value={activeTab} onValueChange={onTabChange}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="simple" className="gap-1.5">
                        <Wand2 className="size-3.5" />
                        Простой
                      </TabsTrigger>
                      <TabsTrigger value="advanced" className="gap-1.5">
                        {advancedPhase === 'loading' ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <BrainCircuit className="size-3.5" />
                        )}
                        Продвинутый
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <p className="px-0.5 text-xs text-muted-foreground">{TAB_HINT[activeTab]}</p>
                  {activeTab === 'advanced' && advancedPhase === 'loading' && (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                      Готовим «Продвинутый» вариант по базе знаний… (~1 минута, пока показан
                      «Простой»)
                    </div>
                  )}
                  {activeTab === 'advanced' && advancedPhase === 'error' && (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 text-destructive">
                        Не удалось сделать «Продвинутый»
                        {advancedErr ? `: ${advancedErr}` : ''}. Показан «Простой».
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadAdvanced()}
                        className="shrink-0 font-medium text-primary hover:underline"
                      >
                        Повторить
                      </button>
                    </div>
                  )}
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
                      Распределить
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

                              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-1.5 rounded-md border bg-background pl-2 sm:min-w-0 sm:flex-1">
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
                                                // Сменили проект — прежняя привязка исполнителя
                                                // (и подсказка-имя) для него уже не релевантна.
                                                assigneeUserId: null,
                                                assigneeName: null,
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

                                <RowAssigneeSelect
                                  options={membersByKey[row.projectId ?? INBOX_VALUE]}
                                  value={row.assigneeUserId}
                                  hintName={row.assigneeName}
                                  onChange={(uid) =>
                                    setRows((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id ? { ...r, assigneeUserId: uid } : r,
                                      ),
                                    )
                                  }
                                  className="sm:min-w-0 sm:flex-1"
                                />

                                {/* Дедлайн в едином бордер-боксе, как проект/исполнитель;
                                    shrink-0 на обёртке (className пикера уходит на кнопку). */}
                                <div className="flex shrink-0 items-center rounded-md border bg-background px-0.5">
                                  <DeadlinePicker
                                    value={row.deadline}
                                    onChange={(d) =>
                                      setRows((prev) =>
                                        prev.map((r) => (r.id === row.id ? { ...r, deadline: d } : r)),
                                      )
                                    }
                                  />
                                </div>
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
