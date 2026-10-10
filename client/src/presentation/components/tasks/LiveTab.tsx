import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, MessageCircleQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useContainer } from '@/infrastructure/di/container';
import { useLiveSession } from '@/presentation/hooks/useLiveSession';
import type { LiveSession } from '@/domain/live/LiveSession';
import type {
  LiveEvent,
  LiveBashPayload,
  LiveFileEditPayload,
  LiveToolUsePayload,
} from '@/domain/live/LiveEvent';
import type { LiveFileDiff } from '@/domain/live/LiveFileDiff';
import { type Task } from '@/domain/task/Task';
import type { TaskComment } from '@/domain/task/TaskComment';
import { CommentBody } from './CommentBody';
import { DiffView } from '@/presentation/components/diff/DiffView';
import { CancelWorkButton } from './CancelWorkButton';
import { TaskDrawerComposer } from './TaskDrawerComposer';
import {
  isRalphQuestionComment,
  parseRalphAnswer,
  parseRalphQuestion,
  RalphAnswerControls,
  type RalphAnswer,
  type RalphQuestion,
} from './RalphQuestionControls';
import {
  LIVE_CHANGED_EVENT,
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
  active?: boolean;
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  onRunningChange?: (running: boolean) => void;
  onCommentCreated?: (c: TaskComment) => void;
  onTaskChanged?: () => void;
};

// LIVE-вкладка: живая лента действий воркера в стиле IDE Cursor, но в теме сайта
// (фон — серый лист панели bg-panel, блоки ленты — карточки bg-card; дизайн C4/C3).
// Сверху — задача с кликабельными фото; снизу — композер промпта (когда работа не идёт)
// или большая кнопка отмены (когда идёт).
export function LiveTab({
  task,
  active = true,
  backlogTail,
  todoTail,
  onRunningChange,
  onCommentCreated,
  onTaskChanged,
}: Props): React.ReactElement {
  const projectId = task.projectId;
  const taskId = task.id;
  const { liveRepository, taskRepository } = useContainer();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Start-сигнал приходит по общему realtime раньше REST-рефетча. Держим его отдельно,
  // чтобы 🔴 включалась в тот же тик, а не после сетевого round-trip списка сессий.
  const [realtimeRunningSessionId, setRealtimeRunningSessionId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(DOM_CAP);
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

  const handleAnswerCreated = useCallback(
    (created: TaskComment): void => {
      setQuestionComments((current) =>
        current.some((comment) => comment.id === created.id) ? current : [...current, created],
      );
      onCommentCreated?.(created);
      onTaskChanged?.();
    },
    [onCommentCreated, onTaskChanged],
  );

  const reloadSessions = useCallback(() => {
    let cancelled = false;
    setSessionsLoading(true);
    void liveRepository
      .listSessions(projectId, taskId)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setRealtimeRunningSessionId(list.find((s) => s.status === 'running')?.id ?? null);
        setSelectedId((prev) =>
          prev && list.some((session) => session.id === prev) ? prev : (list[0]?.id ?? null),
        );
      })
      .catch(() => {
        /* tolerate */
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, liveRepository]);

  useEffect(() => reloadSessions(), [reloadSessions]);

  useEffect(() => {
    const onChanged = (e: Event): void => {
      const detail = (
        e as CustomEvent<{
          projectId?: string;
          taskId?: string;
          sessionId?: string;
          status?: LiveSession['status'];
        }>
      ).detail;
      if (
        e.type === LIVE_CHANGED_EVENT &&
        (detail?.projectId !== projectId || detail?.taskId !== taskId)
      ) {
        return;
      }

      // Оптимистично применяем lifecycle-сигнал до GET /sessions. Это мгновенно
      // включает/гасит красную точку и сразу выбирает новый активный прогон.
      if (detail?.sessionId && detail.status) {
        const sessionStatus = detail.status;
        if (sessionStatus === 'running') {
          setRealtimeRunningSessionId(detail.sessionId);
          setSelectedId(detail.sessionId);
        } else {
          setRealtimeRunningSessionId((current) =>
            current === detail.sessionId ? null : current,
          );
          setSessions((current) =>
            current.map((session) =>
              session.id === detail.sessionId ? { ...session, status: sessionStatus } : session,
            ),
          );
        }
      }

      void liveRepository
        .listSessions(projectId, taskId)
        .then((list) => {
          setSessions(list);
          const fresh = list.find((s) => s.status === 'running');
          setRealtimeRunningSessionId(fresh?.id ?? null);
          setSelectedId((current) => {
            if (fresh) return fresh.id;
            if (current && list.some((session) => session.id === current)) return current;
            return list[0]?.id ?? null;
          });
        })
        .catch(() => undefined);
    };
    window.addEventListener(LIVE_CHANGED_EVENT, onChanged);
    window.addEventListener(REALTIME_CONNECTED_EVENT, onChanged);
    return () => {
      window.removeEventListener(LIVE_CHANGED_EVENT, onChanged);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, onChanged);
    };
  }, [projectId, taskId, liveRepository]);

  const { events, session, fileDiffs, loading, running } = useLiveSession(
    projectId,
    taskId,
    // Лента должна продолжать наполняться, пока юзер читает «Обсуждение». TabsContent
    // скрыт визуально, но forceMount сохраняет компонент и его task-scoped SSE.
    selectedId,
  );

  const anyRunning = useMemo(
    () => realtimeRunningSessionId !== null || sessions.some((s) => s.status === 'running'),
    [realtimeRunningSessionId, sessions],
  );
  useEffect(() => {
    onRunningChange?.(anyRunning);
  }, [anyRunning, onRunningChange]);

  // «Работа идёт» — приоритетно по live-сессии (а не только по task.status, который
  // может отставать). Тогда снизу гарантированно большая кнопка «Отменить работу».
  const isWorking = running || anyRunning || task.status === 'in_progress';

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 80;
  }, []);

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }));
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom();
  }, [events.length, dispatcherQuestions.length, running, scrollToBottom]);

  useEffect(() => {
    if (active && stickToBottomRef.current) scrollToBottom();
  }, [active, scrollToBottom]);

  useEffect(() => {
    setVisibleCount(DOM_CAP);
    stickToBottomRef.current = true;
  }, [selectedId]);

  const shown = useMemo(
    () => (events.length > visibleCount ? events.slice(events.length - visibleCount) : events),
    [events, visibleCount],
  );
  const hiddenCount = events.length - shown.length;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  function sessionLabel(s: LiveSession): string {
    return `Попытка ${s.attempt} · ${STATUS_LABEL_RU[s.status]} · ${SESSION_TIME_FMT.format(s.startedAt)}`;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-foreground">
      {/* Шапка задачи убрана — задача видна в левой колонке окна (split/edit). */}

      {/* Селектор попыток. */}
      {sessions.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-be border-border px-3 py-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Выбрать попытку"
                className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-field px-2 text-start text-xs text-foreground transition-colors hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">
                  {selected ? sessionLabel(selected) : 'Сессия'}
                </span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={selectedId ?? ''}
                onValueChange={(v: string) => setSelectedId(v)}
              >
                {sessions.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id} className="text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{sessionLabel(s)}</span>
                      {s.status === 'running' && (
                        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {running && (
            // «В эфире» — красная точка, как у записи; метка без свечения (C4: без декора).
            <span className="flex shrink-0 items-center gap-1 rounded-sm bg-destructive-soft px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-destructive">
              <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
              LIVE
            </span>
          )}
        </div>
      )}

      {/* Лента событий. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
        {sessionsLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="me-2 size-4 motion-safe:animate-spin" /> Загрузка…
          </div>
        ) : sessions.length === 0 ? (
          dispatcherQuestions.length === 0 && !questionsLoading ? <EmptyState working={isWorking} /> : null
        ) : loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="me-2 size-4 motion-safe:animate-spin" /> Загрузка ленты…
          </div>
        ) : (
          <>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + DOM_CAP)}
                className="mx-auto block rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                Загрузить ранее ({hiddenCount})
              </button>
            )}
            {shown.map((ev) => (
              <LiveEventRow key={ev.seq} event={ev} />
            ))}
            {running && <ClaudeSpinner startedAt={session?.startedAt} />}
            {events.length === 0 && !running && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Нет событий в этой сессии.
              </p>
            )}
            {session && session.status !== 'running' && fileDiffs.length > 0 && (
              <FinalDiffs files={fileDiffs} session={session} />
            )}
          </>
        )}
        {questionsLoading && sessions.length === 0 && dispatcherQuestions.length === 0 && (
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

      {/* «Летающий» футер: идёт работа — большая кнопка отмены; иначе — композер промпта. */}
      <div className="shrink-0">
        {isWorking ? (
          <CancelWorkButton task={task} onChanged={() => onTaskChanged?.()} />
        ) : task.status === 'awaiting_clarification' ? (
          <>
            <CancelWorkButton task={task} onChanged={() => onTaskChanged?.()} />
            <TaskDrawerComposer
              task={task}
              backlogTail={backlogTail}
              todoTail={todoTail}
              onCommentCreated={(c) => onCommentCreated?.(c)}
              onTaskChanged={() => onTaskChanged?.()}
            />
          </>
        ) : (
          <TaskDrawerComposer
            task={task}
            backlogTail={backlogTail}
            todoTail={todoTail}
            onCommentCreated={(c) => onCommentCreated?.(c)}
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

function DispatcherQuestionCard({
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
  const answerText = Array.isArray(answer?.value) ? answer.value.join(', ') : answer?.value;
  return (
    // Вопрос ждёт решения человека — смысл «на утверждении» (фиолетовый). Карточка
    // нейтральная, цвет живёт в иконке и подписи.
    <section className="rounded-lg bg-card p-3 shadow-card" aria-label="Вопрос диспетчера">
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
      </div>
      <CommentBody body={comment.body} className={cn(RICH_MD, 'text-sm')} />
      {answer ? (
        <div className="mbs-2 flex items-start gap-1.5 rounded-md bg-done-soft px-2.5 py-2 text-xs text-done-ink">
          <CheckCircle2 className="mbs-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">Ответ принят</span>
            {answerText ? `: ${answerText}` : ''}
          </span>
        </div>
      ) : (
        <RalphAnswerControls
          question={question}
          projectId={projectId}
          taskId={taskId}
          onCreated={onAnswerCreated}
        />
      )}
    </section>
  );
}

function EmptyState({ working }: { working: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <span className="pf-tone-purple text-2xl text-tone">✻</span>
      <span className="text-sm text-foreground">
        Воркер ещё не запускался по этой задаче.
      </span>
      <span className="max-w-xs text-xs text-muted-foreground">
        {working
          ? 'Воркер вот-вот начнёт — здесь появится живая лента действий.'
          : 'Отправь задачу воркеру (поле ниже) — и здесь в реальном времени пойдёт лента действий, как в IDE.'}
      </span>
    </div>
  );
}

// === Claude Code-style спиннер (мерцающая «снежинка» + ротация слов) ===
const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const SPINNER_WORDS = [
  'Booping',
  'Noodling',
  'Percolating',
  'Simmering',
  'Cogitating',
  'Conjuring',
  'Vibing',
  'Tinkering',
  'Marinating',
  'Computing',
  'Pondering',
  'Brewing',
  'Finagling',
  'Manifesting',
  'Schlepping',
];

function ClaudeSpinner({ startedAt }: { startedAt?: Date }): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const [word, setWord] = useState(0);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    const f = window.setInterval(() => setFrame((x) => (x + 1) % SPINNER_FRAMES.length), 110);
    const w = window.setInterval(() => setWord((x) => (x + 1) % SPINNER_WORDS.length), 2800);
    const s = window.setInterval(() => {
      setSecs((prev) =>
        startedAt ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)) : prev + 1,
      );
    }, 1000);
    return () => {
      window.clearInterval(f);
      window.clearInterval(w);
      window.clearInterval(s);
    };
  }, [startedAt]);

  return (
    <div className="flex items-center gap-2 px-1 py-1.5 font-mono text-xs text-muted-foreground">
      <span className="pf-tone-purple text-tone">{SPINNER_FRAMES[frame]}</span>
      <span className="text-foreground">{SPINNER_WORDS[word]}…</span>
      <span className="opacity-60">({secs}s)</span>
    </div>
  );
}

// Маленький круглый маркер слева (вместо иконок) — таймлайн в духе Claude Code «⏺».
// Вид события — категория без смысла статуса, поэтому цвет — тон Notion (`pf-tone-* bg-tone`);
// только ошибка инструмента красится статусным красным.
function Dot({ tone }: { tone: string }): React.ReactElement {
  return <span className={cn('mbs-[7px] size-1.5 shrink-0 rounded-full', tone)} aria-hidden />;
}

// === Ряд ленты — рендер по kind ===
function LiveEventRow({ event }: { event: LiveEvent }): React.ReactElement | null {
  switch (event.kind) {
    case 'assistant_text': {
      const text = event.text ?? '';
      if (text.trim().length === 0) return null;
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
      const command = payload?.command ?? event.text ?? '';
      return (
        <div className="flex gap-2">
          <Dot tone="pf-tone-blue bg-tone" />
          <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card">
            <div className="border-be border-border bg-muted/60 px-2.5 py-1 text-2xs uppercase tracking-wider text-muted-foreground">
              терминал
            </div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-2xs leading-relaxed text-foreground">
              <span className="pf-tone-blue select-none text-tone">$ </span>
              {command}
            </pre>
          </div>
        </div>
      );
    }
    case 'tool_error': {
      return (
        <div className="flex gap-2">
          <Dot tone="bg-destructive" />
          <div className="min-w-0 flex-1 overflow-hidden rounded-md bg-destructive-soft">
            <div className="px-2.5 py-1 text-2xs font-medium uppercase tracking-wider text-destructive">
              ошибка инструмента
            </div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-foreground">
              {event.text ?? ''}
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
      const payload = event.payload as LiveFileEditPayload | null;
      if (!payload) return null;
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
          <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-card px-2 py-1 font-mono text-2xs leading-relaxed text-foreground">
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
    <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-1.5 border-be border-border bg-muted/60 px-2.5 py-1 font-mono text-2xs text-muted-foreground">
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
            'rounded-sm px-1.5 py-0.5 font-medium uppercase tracking-wider',
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
        className="flex w-full items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 motion-safe:transition-transform', open && 'rotate-90')} />
        <span>Изменения · {files.length} файл(ов)</span>
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
    <div className="overflow-clip rounded-md border border-border bg-card">
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
