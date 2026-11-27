import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, MessageCircleQuestion } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { readableWorkerCommand } from '@/lib/readableWorkerCommand';
import { isWorkerStartupNotice } from '@/lib/isWorkerStartupNotice';
import { parseWorkerResult } from '@/domain/live/WorkerResult';
import { parseFileEditPayload, finalDiffForFileEdit } from '@/domain/live/fileEditPayload';
import { WorkerResultMessage } from './WorkerResultMessage';
import { useContainer } from '@/infrastructure/di/container';
import { useTaskLiveTimeline } from '@/presentation/hooks/useTaskLiveTimeline';
import { taskLiveTimeline } from '@/domain/live/TaskLiveTimeline';
import { liveFeedRows, type LiveFeedRow } from '@/domain/live/LiveFeedRows';
import {
  isPipelineSession,
  parseCheckResultPayload,
  parseHandoffPayload,
  parseReviewVerdictPayload,
  parseStagePayload,
  pipelineProgress,
  pipelineStopReason,
} from '@/domain/live/LivePipeline';
import { CheckResultRow, formatElapsed, HandoffDivider, pipelineCaption, PipelineStepper, ReviewVerdictCard, RoleTurn, STAGE_LABEL, StageLine, ToolJournal } from './LivePipeline';
import { WorkerChatMessage } from './WorkerChatMessage';
import type { LiveSession } from '@/domain/live/LiveSession';
import type {
  LiveEvent,
  LiveBashPayload,
  LiveToolUsePayload,
} from '@/domain/live/LiveEvent';
import type { LiveFileDiff } from '@/domain/live/LiveFileDiff';
import { RUN_MODE_META, type RunMode, type Task } from '@/domain/task/Task';
import type { TaskComment } from '@/domain/task/TaskComment';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { CommentBody } from './CommentBody';
import { DiffView } from '@/presentation/components/diff/DiffView';
import { CancelWorkButton } from './CancelWorkButton';
import { TaskDrawerComposer } from './TaskDrawerComposer';
import { RunWithWorkerButton } from './RunWithWorkerButton';
import { LiveQueueStatus, LiveRunModeNote } from './LiveQueueStatus';
import { isLiveNearBottom, scrollLiveToBottom } from './liveScroll';
import {
  isRalphQuestionComment,
  parseRalphAnswer,
  parseRalphQuestion,
  RalphAnswerControls,
  type RalphAnswer,
  type RalphQuestion,
} from './RalphQuestionControls';
import {
  REALTIME_CONNECTED_EVENT,
  TASK_CHANGED_EVENT,
} from '@/presentation/hooks/useNotificationStream';

const DOM_CAP = 300;

const SESSION_TIME_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_LABEL_RU: Record<LiveSession['status'], string> = {
  running: 'идёт',
  completed: 'завершено',
  failed: 'ошибка',
  timeout: 'таймаут',
  canceled: 'отменено',
};

// Конвейер — мужской род и короче: «Конвейер · попытка 2 · идёт».
const PIPELINE_STATUS_RU: Record<LiveSession['status'], string> = {
  running: 'идёт',
  completed: 'завершён',
  failed: 'ошибка',
  timeout: 'таймаут',
  canceled: 'отменён',
};

// Подпись начала запуска. Сессия, которая уже не текущая, но всё ещё «running» в ответе
// сервера, читается как завершённая (её сменил следующий запуск).
// Режим запуска сессии берём из задачи (spec §5); старые данные без поля — 'quick'.
const taskRunMode = (task: Task): RunMode => (task.runMode === 'full' ? 'full' : 'quick');

function runCaption(session: LiveSession, current: boolean): string {
  const status = session.status === 'running' && !current ? 'completed' : session.status;
  if (isPipelineSession(session)) return `Конвейер · попытка ${session.attempt} · ${PIPELINE_STATUS_RU[status]}`;
  return `Воркер ${status === 'running' ? 'работает' : STATUS_LABEL_RU[status]}`;
}

// Богатый markdown для текста ассистента: крупные заголовки (H1 как заголовок),
// жирные акценты — в духе Notion/Cursor. Перебивает мелкий prose-sm у CommentBody
// (селекторы `.class h1` сильнее, чем prose-sm-овский `:where(h1)`).
const RICH_MD =
  '[&_h1]:mbe-1.5 [&_h1]:mbs-3 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:leading-tight ' +
  '[&_h2]:mbe-1 [&_h2]:mbs-2.5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mbe-0.5 [&_h3]:mbs-2 ' +
  '[&_h3]:text-sm [&_h3]:font-semibold [&_strong]:font-semibold [&_ul]:my-1.5 [&_ol]:my-1.5 ' +
  '[&_li]:my-0.5 [&_p]:my-1.5';

type Props = {
  task: Task;
  fillHeight?: boolean;
  active?: boolean;
  canEdit?: boolean;
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  onRunningChange?: (running: boolean) => void;
  onCommentCreated?: (c: TaskComment) => void;
  onTaskChanged?: () => void;
  // Ответ PATCH из LIVE (смена режима запуска) — окно задачи обновляет свой снимок.
  onTaskUpdated?: (updated: Task) => void;
  onApprovalReturned?: (updated: Task) => void;
};

// LIVE-вкладка: живая лента действий воркера в стиле IDE Cursor, но в теме сайта
// (фон — серый лист панели bg-panel, блоки ленты — карточки bg-card; дизайн C4/C3).
// Сверху — задача с кликабельными фото; снизу — композер промпта (когда работа не идёт)
// или большая кнопка отмены (когда идёт).
export function LiveTab(props: Props): React.ReactElement {
  return <TaskLiveChat key={`${props.task.projectId}:${props.task.id}`} {...props} />;
}

function TaskLiveChat({
  task: sourceTask,
  fillHeight = false,
  active = true,
  canEdit = sourceTask.canEdit !== false,
  backlogTail,
  todoTail,
  onRunningChange,
  onCommentCreated,
  onTaskChanged,
  onTaskUpdated,
  onApprovalReturned,
}: Props): React.ReactElement {
  // Подтверждённый сервером ответ (отмена, постановка в очередь, смена режима) живёт,
  // пока родитель не прислал свежую задачу; дальше правда — серверный статус из пропса.
  const [cancelResult, setCancelResult] = useState<{ source: Task; task: Task } | null>(null);
  const task = cancelResult?.source === sourceTask ? cancelResult.task : sourceTask;
  const handleCancelChanged = (updated: Task): void => {
    setCancelResult({ source: sourceTask, task: updated });
    onTaskChanged?.();
  };
  const handleModeChanged = (updated: Task): void => {
    setCancelResult({ source: sourceTask, task: { ...task, runMode: updated.runMode, updatedAt: updated.updatedAt } });
    onTaskUpdated?.(updated);
    onTaskChanged?.();
  };
  // Когда задачу поставили в очередь отсюда — точное время клика; иначе — последнее
  // изменение задачи (перенос в «Воркер» его обновляет).
  const [queuedAt, setQueuedAt] = useState<Date | null>(null);
  const projectId = task.projectId;
  const taskId = task.id;
  const { taskRepository, projectRepository } = useContainer();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  useEffect(() => {
    let disposed = false;
    void projectRepository.listMembers(projectId).then(list => { if (!disposed) setMembers(list); }).catch(() => {});
    return () => { disposed = true; };
  }, [projectId, projectRepository]);
  const { runs, loading: sessionsLoading, error: timelineError } = useTaskLiveTimeline(projectId, taskId);
  const [visibleCount, setVisibleCount] = useState(DOM_CAP);
  // While the reader is above the tail, the window keeps its first row: new actions
  // must not push rows out of the DOM above the text being read.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const firstShownKeyRef = useRef<string | null>(null);
  const [questionComments, setQuestionComments] = useState<TaskComment[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const questionRequestRef = useRef(0);

  const reloadQuestionComments = useCallback((): void => {
    const requestId = ++questionRequestRef.current;
    void taskRepository
      .listComments(projectId, taskId)
      .then((comments) => {
        if (requestId === questionRequestRef.current) setQuestionComments(comments);
      })
      .catch(() => {
        /* Не ломаем LIVE, если отдельно не загрузился тред вопросов. */
      })
      .finally(() => {
        if (requestId === questionRequestRef.current) setQuestionsLoading(false);
      });
  }, [projectId, taskId, taskRepository]);

  useEffect(() => {
    setQuestionsLoading(true);
    reloadQuestionComments();
    return () => {
      questionRequestRef.current += 1;
    };
  }, [reloadQuestionComments]);

  // Вопрос диспетчера создаётся агентом как task-comment. Слушаем общий realtime
  // сигнал задачи и подхватываем карточку в LIVE без обновления страницы/переключения вкладок.
  useEffect(() => {
    let timer: number | null = null;
    const schedule = (): void => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(reloadQuestionComments, 250);
    };
    const onTaskChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ projectId?: string; taskId?: string }>).detail;
      if (detail?.projectId !== projectId) return;
      if (detail.taskId && detail.taskId !== taskId) return;
      schedule();
    };
    const onConnected = (): void => schedule();
    window.addEventListener(TASK_CHANGED_EVENT, onTaskChanged);
    window.addEventListener(REALTIME_CONNECTED_EVENT, onConnected);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener(TASK_CHANGED_EVENT, onTaskChanged);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, onConnected);
    };
  }, [projectId, taskId, reloadQuestionComments]);

  const dispatcherQuestions = useMemo<
    Array<{ comment: TaskComment; question: RalphQuestion }>
  >(
    () =>
      questionComments.flatMap((comment) => {
        if (!isRalphQuestionComment(comment)) return [];
        const question = parseRalphQuestion(comment.body);
        return question ? [{ comment, question }] : [];
      }),
    [questionComments],
  );

  const answersByQid = useMemo(() => {
    const answers = new Map<string, RalphAnswer>();
    for (const comment of questionComments) {
      const answer = parseRalphAnswer(comment.body);
      if (answer) answers.set(answer.qid, answer);
    }
    return answers;
  }, [questionComments]);

  // Ответ на вопрос диспетчера: сервер сразу возвращает задачу из «На уточнении».
  // Не ждём, пока родитель перерисует нас: перечитываем задачу и переходим в живое
  // состояние очереди по серверному статусу. 'pending' — ответ отправлен, статус ещё читаем.
  const [answerState, setAnswerState] = useState<'pending' | 'reopened' | null>(null);
  const handleAnswerCreated = (created: TaskComment): void => {
    setQuestionComments((current) =>
      current.some((comment) => comment.id === created.id) ? current : [...current, created],
    );
    onCommentCreated?.(created);
    setAnswerState('pending');
    const source = sourceTask;
    void taskRepository.get(projectId, taskId)
      .then((fresh) => {
        setCancelResult({ source, task: fresh });
        if (fresh.status === 'todo') setQueuedAt(new Date());
        setAnswerState(fresh.status === 'awaiting_clarification' ? null : 'reopened');
      })
      .catch((error: unknown) => {
        setAnswerState(null);
        toast.error(`Ответ сохранён, но не удалось обновить статус задачи: ${error instanceof Error ? error.message : String(error)}`);
      });
    onTaskChanged?.();
  };

  const latestRun = runs.at(-1);
  const runningRun = latestRun?.session.status === 'running' ? latestRun : undefined;
  const anyRunning = !!runningRun;
  useEffect(() => { onRunningChange?.(anyRunning); }, [anyRunning, onRunningChange]);
  const isWorking = anyRunning;
  // «В очереди» — только серверный статус todo без идущей сессии. Никаких локальных
  // флагов, которые переживают отмену и не сверяются с сервером.
  const queued = task.status === 'todo' && !isWorking;
  useEffect(() => { if (!queued) setQueuedAt(null); }, [queued]);
  useEffect(() => { if (isWorking) setAnswerState(null); }, [isWorking]);
  const answerAccepted = answerState === 'pending' || (answerState === 'reopened' && !isWorking && task.status !== 'awaiting_clarification');
  const handleChatComment = (created: TaskComment): void => {
    stickToBottomRef.current = true;
    setPinnedKey(null);
    setQuestionComments(current => current.some(comment => comment.id === created.id) ? current.map(comment => comment.id === created.id ? created : comment) : [...current, created]);
    onCommentCreated?.(created);
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const onScroll = useCallback((): void => {
    if (!scrollRef.current?.clientHeight) return;
    const nearBottom = isLiveNearBottom(scrollRef.current);
    stickToBottomRef.current = nearBottom;
    setShowScrollBottom(!nearBottom);
    setPinnedKey(current => nearBottom ? null : current ?? firstShownKeyRef.current);
  }, []);

  const scrollToBottom = useCallback((): void => {
    // Apply before paint. A queued animation frame can run after the user scrolls up.
    scrollLiveToBottom(scrollRef.current);
    setShowScrollBottom(false);
  }, []);

  // Cancel follow mode before native scrolling starts, including small trackpad
  // deltas. No preventDefault: wheel/touch/keyboard retain browser scrolling.
  const pauseFollow = useCallback((): void => {
    stickToBottomRef.current = false;
    setPinnedKey(current => current ?? firstShownKeyRef.current);
  }, []);
  const followTail = useCallback((): void => {
    stickToBottomRef.current = true;
    setPinnedKey(null);
  }, []);
  // Постановку в очередь показываем по ответу сервера (статус todo), а не оптимистично.
  const handleQueued = (updated: Task): void => {
    followTail();
    setCancelResult({ source: sourceTask, task: { ...task, ...updated } });
    if (updated.status === 'todo') setQueuedAt(new Date());
  };

  // Every opening (including a force-mounted tab) starts at the newest message.
  useLayoutEffect(() => {
    setVisibleCount(DOM_CAP);
    setPinnedKey(null);
    stickToBottomRef.current = true;
    setShowScrollBottom(false);
    if (active) {
      panelRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      scrollToBottom();
    }
  }, [active, projectId, taskId, scrollToBottom]);

  // Replay, questions and final diffs arrive independently, sometimes with the same count.
  useLayoutEffect(() => {
    if (active && stickToBottomRef.current) scrollToBottom();
  }, [active, runs, questionComments, visibleCount, scrollToBottom]);

  // A hidden tab has no height; images and expanded messages can resize after React commits.
  // Watch both the viewport and its content, while preserving manual reading higher up.
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!active || !viewport || !content) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom();
    });
    observer?.observe(viewport);
    observer?.observe(content);
    return () => {
      observer?.disconnect();
    };
  }, [active, scrollToBottom]);

  const entries = useMemo(() => taskLiveTimeline(runs, questionComments), [runs, questionComments]);
  const rows = useMemo(() => liveFeedRows(entries, runs), [entries, runs]);
  const tailStart = Math.max(0, rows.length - visibleCount);
  const pinnedIndex = pinnedKey ? rows.findIndex(row => row.key === pinnedKey) : -1;
  const shown = rows.slice(pinnedIndex >= 0 ? Math.min(pinnedIndex, tailStart) : tailStart);
  const hiddenCount = rows.length - shown.length;
  useLayoutEffect(() => { firstShownKeyRef.current = shown[0]?.key ?? null; });

  const pipelineRun = latestRun && isPipelineSession(latestRun.session) ? latestRun : undefined;
  const progress = useMemo(() => pipelineRun ? pipelineProgress(pipelineRun.events, pipelineRun.session.status) : null, [pipelineRun]);
  const finishedOutcome = progress && progress.outcome !== 'running' ? progress.outcome : null;
  // Прошлый запуск не довёл задачу: предлагаем «Запустить снова», а не «Сделать с помощью воркера».
  const relaunch = task.status === 'awaiting_clarification' || finishedOutcome === 'blocked' || finishedOutcome === 'stopped';
  const stopReason = useMemo(() => pipelineRun && finishedOutcome === 'blocked' ? pipelineStopReason(pipelineRun.events) : null, [pipelineRun, finishedOutcome]);
  const activeStage = progress?.outcome === 'running' ? progress.steps.find(step => step.state === 'active')?.stage : undefined;
  const executing = activeStage === 'execute';
  const spinnerStage = activeStage ? STAGE_LABEL[activeStage] : undefined;
  const liveJournalKey = runningRun && pipelineRun === runningRun && executing
    ? rows.findLast(row => row.kind === 'tools' && row.sessionId === runningRun.session.id)?.key ?? null : null;

  return (
    <div ref={panelRef} data-pf-live-panel="" className={cn('flex min-h-0 flex-col bg-panel text-foreground', fillHeight ? 'h-full flex-1' : 'h-[70dvh] shrink-0')}>
      {/* Шапка задачи убрана — задача видна в левой колонке окна (split/edit). */}
      {/* Новый запуск ждёт диспетчера — прошлый (прерванный/завершённый) прогон не должен
          выдавать себя за текущее состояние: сворачиваем его в историю. */}
      {progress && (queued && progress.outcome !== 'running' ? (
        <details data-pf-previous-run="" className="shrink-0 border-be border-border bg-card px-3 py-1.5 text-2xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Предыдущий запуск · {pipelineCaption(progress)}</summary>
          <div className="mbs-1.5"><PipelineStepper progress={progress} /></div>
        </details>
      ) : <PipelineStepper progress={progress} />)}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheelCapture={(event) => { if (event.deltaY < 0) pauseFollow(); }}
        onTouchStartCapture={pauseFollow}
        onKeyDownCapture={(event) => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pauseFollow(); }}
        data-pf-worker-chat=""
        tabIndex={0}
        role="log"
        aria-live="off"
        aria-label="Чат с воркером"
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pbs-3 pbe-14 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
      <div ref={contentRef} className="space-y-2.5">
        {sessionsLoading && rows.length === 0 && <div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 className="me-2 size-4 motion-safe:animate-spin" /> Загрузка…</div>}
        {timelineError && <p role="status" className="text-sm text-muted-foreground">{timelineError}</p>}
        {hiddenCount > 0 && <button type="button" onClick={() => setVisibleCount(count => count + DOM_CAP)} className="mx-auto block rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:opacity-80">Показать ранее ({hiddenCount})</button>}
        {shown.map((entry, index) => {
          if (entry.kind === 'message') return <WorkerChatMessage key={entry.key} projectId={projectId} comment={entry.comment} authorName={members.find(member => member.userId === entry.comment.ownerUserId)?.user.displayName ?? 'Участник'} />;
          if (entry.kind === 'event' || entry.kind === 'tools') return <FeedRow key={entry.key} row={entry} firstShown={index === 0} live={entry.key === liveJournalKey} finalFiles={runs.find(run => run.session.id === entry.sessionId)?.fileDiffs} />;
          if (entry.kind === 'finish') return entry.run.fileDiffs.length > 0 ? <FinalDiffs key={entry.key} files={entry.run.fileDiffs} session={entry.run.session} /> : null;
          return <p key={entry.key} data-worker-run={entry.session.id} className="pbs-3 text-center text-xs text-muted-foreground">{SESSION_TIME_FMT.format(entry.session.startedAt)} · {runCaption(entry.session, entry.session.id === runningRun?.session.id)}{entry.session.id === runs.at(-1)?.session.id && <span data-run-mode={taskRunMode(task)}> · {RUN_MODE_META[taskRunMode(task)].label}</span>}</p>;
        })}
        {runningRun && <ClaudeSpinner key={runningRun.session.id} startedAt={runningRun.session.startedAt} label={pipelineRun === runningRun ? spinnerStage : undefined} />}
        {runningRun && <LiveRunModeNote task={task} />}
        {stopReason && !queued && !isWorking && (
          <div role="status" data-pf-live-stop-reason="" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm">
            <p className="font-medium text-destructive">Почему остановлено: {stopReason.title}</p>
            {stopReason.line && <p className="mbs-0.5 truncate font-mono text-xs text-muted-foreground" title={stopReason.line}>{stopReason.line}</p>}
          </div>
        )}
        {answerAccepted && (
          <p role="status" data-pf-live-answer-accepted="" className="flex items-center gap-1.5 rounded-lg bg-done-soft px-3 py-2 text-sm text-done-ink">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Ответ принят — задача снова в очереди
          </p>
        )}
        {queued && <LiveQueueStatus task={task} queuedSince={queuedAt ?? task.updatedAt} canEdit={canEdit} onTaskChanged={handleModeChanged} />}
        {!sessionsLoading && runs.length === 0 && rows.length === 0 && dispatcherQuestions.length === 0 && !questionsLoading && <EmptyState working={isWorking} queued={queued} task={task} />}
        {questionsLoading && !sessionsLoading && runs.length === 0 && dispatcherQuestions.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="me-2 size-4 motion-safe:animate-spin" /> Загрузка вопросов…
          </div>
        )}
        {dispatcherQuestions.map(({ comment, question }) => (
          <DispatcherQuestionCard
            key={comment.id}
            comment={comment}
            question={question}
            answer={answersByQid.get(question.qid) ?? null}
            projectId={projectId}
            taskId={taskId}
            onAnswerCreated={handleAnswerCreated}
          />
        ))}
      </div>
      </div>
      {/* The overlay belongs to the visible viewport, never to message flow. */}
      {active && (
        <button type="button" aria-label="К последнему сообщению" title="К последнему сообщению"
          className={cn('absolute inset-be-3 start-1/2 -translate-x-1/2 z-10 grid size-10 place-items-center rounded-full bg-raised shadow-float focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:opacity-80', showScrollBottom ? 'text-foreground' : 'text-muted-foreground')}
          onClick={() => { followTail(); scrollToBottom(); }}>
          <ChevronDown className="size-5" aria-hidden />
        </button>
      )}
      </div>

      {/* «Летающий» футер: идёт работа — большая кнопка отмены; иначе — композер промпта. */}
      <div className="shrink-0">
        {!isWorking && canEdit && <RunWithWorkerButton key={task.id} task={task} relaunch={relaunch} onQueued={handleQueued} onChanged={onTaskChanged} />}
        {/* «Отменить работу» — только пока воркер реально работает (или ждём подтверждения
            уже запрошенной отмены). Запаркованная/упавшая задача получает «Запустить снова». */}
        {isWorking || task.ralphCancelRequestedAt ? (
          canEdit ? <CancelWorkButton task={task} workerRunning={isWorking} onChanged={handleCancelChanged} /> : null
        ) : task.status === 'awaiting_clarification' ? (
          <>
            <TaskDrawerComposer
              task={{ ...task, canEdit }}
              backlogTail={backlogTail}
              todoTail={todoTail}
              onCommentCreated={handleChatComment}
            defaultTarget="worker"
            onWorkerQueued={handleQueued}
              onTaskChanged={() => onTaskChanged?.()}
            />
          </>
        ) : (
          <TaskDrawerComposer
            task={{ ...task, canEdit }}
            backlogTail={backlogTail}
            todoTail={todoTail}
            onCommentCreated={handleChatComment}
            onApprovalReturned={onApprovalReturned}
              defaultTarget="worker"
              onWorkerQueued={handleQueued}
            onTaskChanged={() => onTaskChanged?.()}
          />
        )}
      </div>
    </div>
  );
}

const QUESTION_TIME_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function DispatcherQuestionCard({
  comment,
  question,
  answer,
  projectId,
  taskId,
  onAnswerCreated,
}: {
  comment: TaskComment;
  question: RalphQuestion;
  answer: RalphAnswer | null;
  projectId: string;
  taskId: string;
  onAnswerCreated: (created: TaskComment) => void;
}): React.ReactElement {
  const answered = Boolean(answer);
  const [collapsed, setCollapsed] = useState(answered);
  // Ответ пришёл, пока карточка открыта, — сворачиваем: вопрос больше не ждёт человека.
  useEffect(() => { if (answered) setCollapsed(true); }, [answered]);
  const answerText = Array.isArray(answer?.value) ? answer.value.join(', ') : answer?.value;
  return (
    // Вопрос ждёт решения человека — смысл «на утверждении» (фиолетовый). Карточка
    // нейтральная, цвет живёт в иконке и подписи.
    <section id={`comment-${comment.id}`} className="rounded-lg bg-card p-3 shadow-card" aria-label="Вопрос диспетчера">
      <div className="mbe-2 flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-approval-soft text-approval">
          <MessageCircleQuestion className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-approval-ink">Вопрос диспетчера</p>
          <p className="text-2xs text-muted-foreground">
            {QUESTION_TIME_FMT.format(comment.createdAt)}
          </p>
        </div>
        <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground">
          {collapsed ? 'Показать вопрос' : 'Скрыть вопрос'}
        </button>
      </div>
      <div hidden={collapsed}>
      <CommentBody body={comment.body} className={cn(RICH_MD, 'text-sm')} />
      {!answer && (
        <RalphAnswerControls
          question={question}
          projectId={projectId}
          taskId={taskId}
          onCreated={onAnswerCreated}
        />
      )}
      </div>
      {answer && (
        <div className="mbs-2 flex items-start gap-1.5 rounded-md bg-done-soft px-2.5 py-2 text-xs text-done-ink">
          <CheckCircle2 className="mbs-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">Ответ принят</span>
            {answerText ? `: ${answerText}` : ''}
          </span>
        </div>
      )}
    </section>
  );
}

function EmptyState({ working, task, queued: queuedByUser }: { working: boolean; task: Task; queued: boolean }): React.ReactElement {
  const queued = !working && (task.status === 'todo' || queuedByUser);
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <span className="pf-tone-purple text-2xl text-tone">✻</span>
      <span role="status" className="text-sm text-foreground">
        {task.ralphCancelRequestedAt ? 'Ожидаем подтверждения остановки' : working ? 'Воркер работает' : queued ? 'Задача в очереди — ожидает запуска' : task.status === 'in_progress' ? 'Запуск воркера не подтверждён' : 'Воркер ещё не запускался по этой задаче.'}
      </span>
      <span className="max-w-xs text-xs text-muted-foreground">
        {task.ralphCancelRequestedAt
          ? 'Запрос на отмену сохранён. Диспетчер ещё не подтвердил остановку.'
          : working ? 'Диспетчер подтвердил запуск. Здесь появится живая лента действий.'
          : task.status === 'in_progress' ? 'Статус «У воркера» сам по себе не означает запуск воркера. Активной LIVE-сессии пока нет.'
          : queued ? 'Задача сохранена в очереди. Лента действий появится автоматически после запуска.'
          : 'Нажми «Сделать с помощью воркера» — здесь появится лента действий.'}
      </span>
    </div>
  );
}

// === Claude Code-style спиннер (мерцающая «снежинка» + ротация слов) ===
const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
// Нейтральные русские слова: лента не знает, что именно делает воркер в эту секунду.
const SPINNER_WORDS = ['Работаю', 'Думаю', 'Разбираюсь'];

const elapsedSeconds = (startedAtMs: number): number => Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));

// label — текущий этап конвейера («Проверка версии»); без него слова сменяются по кругу.
function ClaudeSpinner({ startedAt, label }: { startedAt: Date; label?: string }): React.ReactElement {
  // Every refresh brings a new Date for the same start: timers are keyed by its value.
  const startedAtMs = startedAt.getTime();
  const [frame, setFrame] = useState(0);
  const [word, setWord] = useState(0);
  // The first frame already shows the real run time, not «(0s)» for a long run.
  const [secs, setSecs] = useState(() => elapsedSeconds(startedAtMs));

  useEffect(() => {
    const f = window.setInterval(() => setFrame((x) => (x + 1) % SPINNER_FRAMES.length), 110);
    const w = window.setInterval(() => setWord((x) => (x + 1) % SPINNER_WORDS.length), 4000);
    const s = window.setInterval(() => setSecs(elapsedSeconds(startedAtMs)), 1000);
    return () => {
      window.clearInterval(f);
      window.clearInterval(w);
      window.clearInterval(s);
    };
  }, [startedAtMs]);

  return (
    <div data-pf-live-spinner="" className="flex items-center gap-2 px-1 py-1.5 text-xs text-muted-foreground">
      <span className="pf-tone-purple w-3 text-center font-mono text-tone">{SPINNER_FRAMES[frame]}</span>
      <span className="text-foreground">{label ?? SPINNER_WORDS[word]}…</span>
      <span className="tabular-nums opacity-60" data-pf-live-elapsed="">({formatElapsed(secs)})</span>
    </div>
  );
}

// Маленький круглый маркер слева (вместо иконок) — таймлайн в духе Claude Code «⏺».
// Вид события — категория без смысла статуса, поэтому цвет — тон Notion (`pf-tone-* bg-tone`);
// только ошибка инструмента красится статусным красным.
function Dot({ tone }: { tone: string }): React.ReactElement {
  return <span className={cn('mbs-[7px] size-1.5 shrink-0 rounded-full', tone)} aria-hidden />;
}

// === Ряд конвейера: роль (аватар один раз на реплику), журнал инструментов, карточки ===
function FeedRow({ row, firstShown, live, finalFiles = [] }: {
  row: Extract<LiveFeedRow, { kind: 'event' | 'tools' }>;
  firstShown: boolean;
  live: boolean;
  finalFiles?: readonly LiveFileDiff[];
}): React.ReactElement | null {
  if (!row.role) {
    if (row.kind !== 'event') return null;
    // ralph-worker: этапы подготовки диспетчера — той же строкой этапа, что в конвейере.
    if (row.stage) return <StageLine stage={row.stage.payload} live={row.stage.live} />;
    return <LiveEventRow event={row.event} finalFiles={finalFiles} />;
  }
  const role = row.role;
  // A window that starts mid-turn still names the speaker of its first row.
  const header = row.header || firstShown;
  if (row.kind === 'tools') return (
    <RoleTurn role={role} header={header}>
      <ToolJournal round={role.round} events={row.events} live={live}>
        {event => <LiveEventRow event={event} finalFiles={finalFiles} />}
      </ToolJournal>
    </RoleTurn>
  );
  const { event } = row;
  if (event.kind === 'handoff') {
    const handoff = parseHandoffPayload(event.payload);
    return handoff ? <HandoffDivider handoff={handoff} /> : <LiveEventRow event={event} />;
  }
  const content = (row.stage ? <StageLine stage={row.stage.payload} live={row.stage.live} /> : pipelineContent(event))
    ?? <LiveEventRow event={event} finalFiles={finalFiles} bare />;
  return <RoleTurn role={role} header={header}>{content}</RoleTurn>;
}

// Orchestrator and reviewer kinds; a malformed payload falls back to the generic row.
function pipelineContent(event: LiveEvent): React.ReactElement | null {
  if (event.kind === 'stage') {
    const stage = parseStagePayload(event.payload);
    return stage ? <StageLine stage={stage} /> : null;
  }
  if (event.kind === 'check_result') {
    const check = parseCheckResultPayload(event.payload);
    return check ? <CheckResultRow check={check} /> : null;
  }
  if (event.kind === 'review_verdict') {
    const verdict = parseReviewVerdictPayload(event.payload);
    return verdict ? <ReviewVerdictCard verdict={verdict} /> : null;
  }
  return null;
}

// === Ряд ленты — рендер по kind ===
function LiveEventRow({ event, finalFiles = [], bare = false }: { event: LiveEvent; finalFiles?: readonly LiveFileDiff[]; bare?: boolean }): React.ReactElement | null {
  switch (event.kind) {
    case 'worker_notice':
      return <p role="status" className="px-1 py-1.5 text-xs text-muted-foreground">{event.text}</p>;
    case 'assistant_text': {
      const text = event.text ?? '';
      if (text.trim().length === 0) return null;
      const result = parseWorkerResult(text);
      if (result) return <WorkerResultMessage result={result} />;
      // Inside a role turn the avatar already marks the speaker.
      if (bare) return <div className="min-w-0 leading-relaxed"><CommentBody body={text} className={RICH_MD} /></div>;
      return (
        <div className="flex gap-2">
          <Dot tone="pf-tone-purple bg-tone" />
          <div className="min-w-0 flex-1 leading-relaxed">
            <CommentBody body={text} className={RICH_MD} />
          </div>
        </div>
      );
    }
    case 'bash': {
      const payload = event.payload as LiveBashPayload | null;
      const command = readableWorkerCommand(payload?.command ?? event.text ?? '');
      return (
        <div className="flex gap-2">
          <Dot tone="pf-tone-blue bg-tone" />
          <div className="min-w-0 flex-1 overflow-hidden rounded-lg bg-muted/60">
            <div className="bg-muted px-2.5 py-1 text-2xs text-muted-foreground">
              терминал
            </div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-2xs leading-relaxed text-foreground"
              style={{ maxBlockSize: '18rem', overflow: 'auto' }}>
              <span className="pf-tone-blue select-none text-tone">$ </span>
              {command}
            </pre>
          </div>
        </div>
      );
    }
    case 'tool_error': {
      if (isWorkerStartupNotice(event.text ?? '')) return null;
      return (
        <div className="flex gap-2">
          <Dot tone="bg-destructive" />
          <div className="min-w-0 flex-1 overflow-hidden rounded-md bg-destructive-soft">
            <div className="px-2.5 py-1 text-2xs font-medium text-destructive">
              ошибка инструмента
            </div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-foreground">
              {event.text?.trim() || 'Воркер сообщил об ошибке инструмента без описания. Подробности не были сохранены.'}
            </pre>
          </div>
        </div>
      );
    }
    case 'tool_use': {
      const payload = event.payload as LiveToolUsePayload | null;
      const name = payload?.name ?? 'tool';
      const brief = payload?.brief ?? event.text ?? '';
      return (
        <div className="flex items-center gap-2 text-xs">
          <Dot tone="pf-tone-blue bg-tone" />
          <span className="pf-tone-blue inline-flex shrink-0 items-center gap-1 rounded-sm bg-tone-bg px-1.5 py-0.5 font-mono text-2xs font-medium text-tone-fg">
            {name}
          </span>
          {brief && (
            <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
              {brief}
            </span>
          )}
        </div>
      );
    }
    case 'file_write': {
      const payload = event.payload as { path?: string; content?: string } | null;
      if (typeof payload?.content !== 'string' || payload.content.length === 0) {
        return <LiveEventRow event={{ ...event, kind: 'file_edit', payload: { path: payload?.path ?? 'файл', edits: [] } }} finalFiles={finalFiles} />;
      }
      return (
        <div className="flex gap-2">
          <Dot tone="pf-tone-green bg-tone" />
          <FileCard icon="+" path={payload?.path ?? 'файл'} tone="add">
            {payload?.content !== undefined && (
              <DiffView mode="hunks" before="" after={payload.content} />
            )}
          </FileCard>
        </div>
      );
    }
    case 'file_edit': {
      const payload = parseFileEditPayload(event.payload);
      if (!payload) return null;
      if (payload.edits.length === 0) {
        const final = finalDiffForFileEdit(payload.path, finalFiles);
        return <div className="flex min-w-0 items-start gap-2">
          <Dot tone="pf-tone-yellow bg-tone" />
          <div className="min-w-0 flex-1">
            {final?.unifiedDiff ? <>
              <p className="mbe-1 text-2xs text-muted-foreground">Итоговые изменения файла за запуск</p>
              <FinalFileDiff file={final} />
            </> : <p className="flex min-w-0 items-start gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-2xs text-muted-foreground" title="Текст этой промежуточной правки не был сохранён.">
              <span className="shrink-0">Изменён файл</span><span className="min-w-0 truncate font-mono" title={payload.path}>{payload.path}</span>
            </p>}
          </div>
        </div>;
      }
      return (
        <div className="flex gap-2">
          <Dot tone="pf-tone-yellow bg-tone" />
          <FileCard icon="✎" path={payload.path} tone="edit">
            <div className="space-y-1.5">
              {payload.edits.map((edit, i) => (
                <DiffView key={i} mode="hunks" before={edit.old} after={edit.new} />
              ))}
            </div>
          </FileCard>
        </div>
      );
    }
    case 'diff_summary':
    case 'session_finished':
      return null;
    default: {
      if (!event.text) return null;
      return (
        <div className="flex gap-2">
          <Dot tone="pf-tone-gray bg-tone" />
          <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/60 px-2 py-1 font-mono text-2xs leading-relaxed text-foreground">
            {event.text}
          </pre>
        </div>
      );
    }
  }
}

function FileCard({
  icon,
  path,
  tone,
  children,
}: {
  icon: string;
  path: string;
  tone: 'add' | 'edit';
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-lg bg-muted/60">
      <div className="flex items-center gap-1.5 bg-muted px-2.5 py-1 font-mono text-2xs text-muted-foreground">
        <span className={cn('text-tone', tone === 'add' ? 'pf-tone-green' : 'pf-tone-yellow')}>
          {icon}
        </span>
        <span className="min-w-0 truncate">{path}</span>
      </div>
      <div className="p-1.5">{children}</div>
    </div>
  );
}

// === Финальные git-диффы ===
function FinalDiffs({
  files,
  session,
}: {
  files: LiveFileDiff[];
  session: LiveSession;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="mbs-3 border-bs border-border pbs-3">
      <div className="mbe-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <span
          className={cn(
            'rounded-sm px-1.5 py-0.5 font-medium',
            session.status === 'completed'
              ? 'bg-done-soft text-done-ink'
              : session.status === 'canceled'
                ? 'bg-warning-soft text-warning-ink'
                : 'bg-destructive-soft text-destructive',
          )}
        >
          {STATUS_LABEL_RU[session.status]}
        </span>
        {session.model && <span className="font-mono">{session.model}</span>}
        {typeof session.costUsd === 'number' && (
          <span className="font-mono">${session.costUsd.toFixed(2)}</span>
        )}
        {typeof session.tokensOut === 'number' && (
          <span className="font-mono">{session.tokensOut.toLocaleString('ru-RU')} ток.</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 motion-safe:transition-transform', open && 'rotate-90')} />
        <span>Изменения: {files.length} файл(ов)</span>
        <span className="ms-1 normal-case tracking-normal text-done">+{totalAdd}</span>
        <span className="normal-case tracking-normal text-destructive">−{totalDel}</span>
      </button>
      {open && (
        <div className="mbs-2 space-y-2">
          {files.map((f) => (
            <FinalFileDiff key={f.path} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FinalFileDiff({ file }: { file: LiveFileDiff }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-clip rounded-lg bg-muted/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 bg-muted/60 px-2.5 py-1 text-start font-mono text-2xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3 shrink-0 motion-safe:transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 truncate">{file.path}</span>
        <span className="ms-auto shrink-0 text-done">+{file.additions}</span>
        <span className="shrink-0 text-destructive">−{file.deletions}</span>
      </button>
      {open && (
        <div className="p-1.5">
          {file.isBinary ? (
            <p className="px-2 py-1 text-2xs italic text-muted-foreground">
              Бинарный файл
            </p>
          ) : file.unifiedDiff ? (
            <>
              <DiffView mode="unified" unifiedDiff={file.unifiedDiff} />
              {file.truncated && (
                <p className="px-2 pbs-1 text-2xs italic text-muted-foreground">
                  дифф обрезан по размеру
                </p>
              )}
            </>
          ) : (
            <p className="px-2 py-1 text-2xs italic text-muted-foreground">
              Нет diff-данных
            </p>
          )}
        </div>
      )}
    </div>
  );
}
