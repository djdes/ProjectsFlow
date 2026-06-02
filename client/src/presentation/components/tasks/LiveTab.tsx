import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
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
import { taskShortId, type Task } from '@/domain/task/Task';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { TaskComment } from '@/domain/task/TaskComment';
import { CommentBody } from './CommentBody';
import { DiffView } from '@/presentation/components/diff/DiffView';
import { CancelWorkButton } from './CancelWorkButton';
import { TaskDrawerComposer } from './TaskDrawerComposer';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { formatBytes, isImageMime } from '@/presentation/components/attachments/files';
import { LIVE_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';

// Сколько последних событий держим в DOM (кап вместо virtualization-либы).
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

// Cursor/VS Code-палитра через CSS-переменные. Применяется на контейнере LIVE поверх .dark,
// чтобы переиспользуемые компоненты (TaskDrawerComposer/CancelWorkButton) и токены bg-background/
// bg-muted/border тоже стали «как в Cursor», а не холодно-чёрными как в slate-теме сайта.
const CURSOR_VARS = {
  '--background': '0 0% 12%', // #1e1e1e
  '--foreground': '0 0% 83%', // #d4d4d4
  '--card': '0 0% 9%',
  '--card-foreground': '0 0% 83%',
  '--popover': '0 0% 12%',
  '--popover-foreground': '0 0% 83%',
  '--muted': '0 0% 16%',
  '--muted-foreground': '215 14% 65%',
  '--accent': '0 0% 18%',
  '--accent-foreground': '0 0% 95%',
  '--border': '0 0% 20%',
  '--input': '0 0% 24%',
} as React.CSSProperties;

type Props = {
  task: Task;
  // Вложения задачи (картинки кликабельны → лайтбокс). Берём из шапки TaskDrawer.
  attachments: TaskAttachment[];
  // Активна ли вкладка LIVE прямо сейчас. forceMount держит LiveTab смонтированным даже
  // на «Обсуждении», поэтому стрим SSE открываем ТОЛЬКО когда вкладка активна (бейдж 🔴
  // считаем из списка сессий, без открытого коннекта).
  active?: boolean;
  // Для расчёта beforeTaskId при move'е из композера (как в «Обсуждении»).
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  // Бейдж 🔴 на триггере вкладки.
  onRunningChange?: (running: boolean) => void;
  // Проброс созданного из LIVE-композера комментария в список «Обсуждения».
  onCommentCreated?: (c: TaskComment) => void;
  // Любое изменение (коммент/move/cancel) — родитель рефетчит board.
  onTaskChanged?: () => void;
};

// LIVE-вкладка: «как в IDE Cursor». Отдельный тёмный скоуп (.dark + Cursor-палитра),
// собственные шрифты/цвета/фон — намеренно отходим от светлой темы сайта.
// Сверху — сама задача с кликабельными фото; в центре — живая лента; снизу —
// «летающий» блок: композер нового промпта, а пока идёт работа — большая кнопка отмены.
export function LiveTab({
  task,
  attachments,
  active = true,
  backlogTail,
  todoTail,
  onRunningChange,
  onCommentCreated,
  onTaskChanged,
}: Props): React.ReactElement {
  const projectId = task.projectId;
  const taskId = task.id;
  const { liveRepository } = useContainer();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(DOM_CAP);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  const reloadSessions = useCallback(() => {
    let cancelled = false;
    setSessionsLoading(true);
    void liveRepository
      .listSessions(projectId, taskId)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch(() => {
        /* tolerate — пустой список */
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, liveRepository]);

  useEffect(() => reloadSessions(), [reloadSessions]);

  // Сервер сигналит о смене live-сессии (старт/финиш прогона) — обновляем список.
  // Авто-переключаемся ТОЛЬКО на новый running-прогон (не дёргаем юзера с просмотра
  // старой завершённой сессии при каждом broadcast'е финиша).
  useEffect(() => {
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string; taskId?: string }>).detail;
      if (detail?.projectId !== projectId || detail?.taskId !== taskId) return;
      void liveRepository
        .listSessions(projectId, taskId)
        .then((list) => {
          setSessions(list);
          const fresh = list.find((s) => s.status === 'running');
          if (fresh) setSelectedId(fresh.id);
        })
        .catch(() => undefined);
    };
    window.addEventListener(LIVE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIVE_CHANGED_EVENT, onChanged);
  }, [projectId, taskId, liveRepository]);

  // Стрим открываем только когда вкладка активна (forceMount держит компонент живым).
  const { events, session, fileDiffs, loading, running } = useLiveSession(
    projectId,
    taskId,
    active ? selectedId : null,
  );

  // Бейдж 🔴 — из списка сессий (дёшево, без открытого SSE на скрытой вкладке).
  const anyRunning = useMemo(() => sessions.some((s) => s.status === 'running'), [sessions]);
  useEffect(() => {
    onRunningChange?.(anyRunning);
  }, [anyRunning, onRunningChange]);

  // Скролл-контейнер с auto-scroll вниз, пока юзер не проскроллил вверх.
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
    if (!el || el.clientHeight === 0) return; // скрытая вкладка (display:none) → пропускаем
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }));
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom();
  }, [events.length, scrollToBottom]);

  // При активации вкладки — прыгаем вниз (на скрытой вкладке scrollHeight был 0).
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
    <div
      className="dark flex h-full min-h-0 flex-col bg-[#1e1e1e] text-[#d4d4d4]"
      style={CURSOR_VARS}
    >
      {/* Шапка: сама задача + кликабельные фото. */}
      <LiveTaskHeader task={task} attachments={attachments} onOpen={setPreview} />

      {/* Селектор попыток (тёмный dropdown — без нативного OS-поповера). */}
      {sessions.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#181818] px-3 py-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Выбрать попытку"
                className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-white/10 bg-[#252526] px-2 text-left text-xs text-[#d4d4d4] hover:bg-white/5"
              >
                <span className="min-w-0 flex-1 truncate">
                  {selected ? sessionLabel(selected) : 'Сессия'}
                </span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="dark max-h-72 w-72 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={selectedId ?? ''}
                onValueChange={(v: string) => setSelectedId(v)}
              >
                {sessions.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id} className="text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{sessionLabel(s)}</span>
                      {s.status === 'running' && (
                        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-rose-400" />
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {running && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
              <span className="size-1.5 animate-pulse rounded-full bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
              LIVE
            </span>
          )}
        </div>
      )}

      {/* Лента событий — собственный scroll-контейнер. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
        {sessionsLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-[#8b949e]">
            <Loader2 className="mr-2 size-4 animate-spin" /> Загрузка…
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState working={task.status === 'in_progress'} />
        ) : loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-[#8b949e]">
            <Loader2 className="mr-2 size-4 animate-spin" /> Загрузка ленты…
          </div>
        ) : (
          <>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + DOM_CAP)}
                className="mx-auto block rounded-md border border-white/10 px-3 py-1 text-xs text-[#8b949e] hover:bg-white/5"
              >
                Загрузить ранее ({hiddenCount})
              </button>
            )}
            {shown.map((ev) => (
              <LiveEventRow key={ev.seq} event={ev} />
            ))}
            {running && (
              <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-[#8b949e]">
                <Loader2 className="size-3 animate-spin" />
                воркер работает…
              </div>
            )}
            {events.length === 0 && !running && (
              <p className="py-6 text-center text-xs text-[#8b949e]">Нет событий в этой сессии.</p>
            )}
            {/* Финал сессии: сводка по файлам + полный unified-diff. */}
            {session && session.status !== 'running' && fileDiffs.length > 0 && (
              <FinalDiffs files={fileDiffs} session={session} />
            )}
          </>
        )}
      </div>

      {/* «Летающий» футер: пока идёт работа — большая кнопка отмены; иначе — композер
          нового промпта (как в «Обсуждении»). На awaiting_clarification — и то, и другое. */}
      <div className="shrink-0">
        {task.status === 'in_progress' ? (
          <CancelWorkButton task={task} onChanged={() => onTaskChanged?.()} />
        ) : (
          <>
            {task.status === 'awaiting_clarification' && (
              <CancelWorkButton task={task} onChanged={() => onTaskChanged?.()} />
            )}
            <TaskDrawerComposer
              task={task}
              backlogTail={backlogTail}
              todoTail={todoTail}
              onCommentCreated={(c) => onCommentCreated?.(c)}
              onTaskChanged={() => onTaskChanged?.()}
            />
          </>
        )}
      </div>

      <AttachmentLightbox attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

// === Шапка задачи (внутри тёмного LIVE-скоупа) ===
function LiveTaskHeader({
  task,
  attachments,
  onOpen,
}: {
  task: Task;
  attachments: TaskAttachment[];
  onOpen: (a: TaskAttachment) => void;
}): React.ReactElement {
  const images = attachments.filter((a) => isImageMime(a.mimeType));
  const files = attachments.filter((a) => !isImageMime(a.mimeType));
  const description = task.description?.trim() ?? '';

  return (
    <div className="shrink-0 border-b border-white/10 bg-[#252526] px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#8b949e]">
        <span className="font-mono">[{taskShortId(task.id)}]</span>
        <span className="opacity-70">задача</span>
      </div>
      {description.length > 0 ? (
        <div className="max-h-28 overflow-y-auto pr-1">
          <CommentBody body={description} className="text-[#d4d4d4]" />
        </div>
      ) : (
        <p className="text-xs italic text-[#8b949e]">Без описания</p>
      )}

      {(images.length > 0 || files.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpen(a)}
              className="size-12 overflow-hidden rounded border border-white/10 transition-transform hover:scale-105 hover:border-white/30"
              title={a.filename}
              aria-label={`Открыть ${a.filename}`}
            >
              <img src={a.url} alt={a.filename} loading="lazy" className="size-full object-cover" />
            </button>
          ))}
          {files.map((a) => (
            <a
              key={a.id}
              href={a.url}
              download={a.filename}
              className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[#cccccc] hover:bg-white/10"
              title={a.filename}
            >
              <FileText className="size-3.5 shrink-0 text-[#8b949e]" />
              <span className="max-w-[140px] truncate">{a.filename}</span>
              <span className="text-[#8b949e]">{formatBytes(a.sizeBytes)}</span>
              <Download className="size-3 shrink-0 text-[#8b949e]" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ working }: { working: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <Sparkles className="size-5 text-[#8b949e]" />
      <span className="text-sm text-[#cccccc]">Воркер ещё не запускался по этой задаче.</span>
      <span className="max-w-xs text-xs text-[#8b949e]">
        {working
          ? 'Воркер вот-вот начнёт — здесь появится живая лента действий.'
          : 'Отправь задачу воркеру (поле ниже) — и здесь в реальном времени пойдёт лента действий, как в IDE.'}
      </span>
    </div>
  );
}

// === Один ряд ленты — рендер по kind, Cursor-стилистика ===
function LiveEventRow({ event }: { event: LiveEvent }): React.ReactElement | null {
  switch (event.kind) {
    case 'assistant_text': {
      const text = event.text ?? '';
      if (text.trim().length === 0) return null;
      return (
        <div className="flex gap-2">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[#c8a2ff]" />
          <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-[#d4d4d4]">
            <CommentBody body={text} className="text-[#d4d4d4]" />
          </div>
        </div>
      );
    }
    case 'bash': {
      const payload = event.payload as LiveBashPayload | null;
      const command = payload?.command ?? event.text ?? '';
      return (
        <div className="overflow-hidden rounded-md border border-white/10 bg-[#0d0d0d]">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-[#8b949e]">
            <Terminal className="size-3" /> терминал
          </div>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[#cdd6e3]">
            <span className="select-none text-[#5a9bff]">$ </span>
            {command}
          </pre>
        </div>
      );
    }
    case 'tool_error': {
      return (
        <div className="overflow-hidden rounded-md border-l-2 border-[#f48771] bg-[#f48771]/[0.07]">
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-[#f48771]">
            ошибка инструмента
          </div>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-[#f0a39a]">
            {event.text ?? ''}
          </pre>
        </div>
      );
    }
    case 'tool_use': {
      const payload = event.payload as LiveToolUsePayload | null;
      const name = payload?.name ?? 'tool';
      const brief = payload?.brief ?? event.text ?? '';
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#9cdcfe]">
            <Wrench className="size-3 text-[#8b949e]" />
            {name}
          </span>
          {brief && (
            <span className="min-w-0 truncate font-mono text-[11px] text-[#8b949e]">{brief}</span>
          )}
        </div>
      );
    }
    case 'file_write': {
      const payload = event.payload as { path?: string; content?: string } | null;
      return (
        <FileCard icon="+" path={payload?.path ?? 'файл'} tone="add">
          {payload?.content !== undefined && (
            <DiffView mode="hunks" before="" after={payload.content} />
          )}
        </FileCard>
      );
    }
    case 'file_edit': {
      const payload = event.payload as LiveFileEditPayload | null;
      if (!payload) return null;
      return (
        <FileCard icon="✎" path={payload.path} tone="edit">
          <div className="space-y-1.5">
            {payload.edits.map((edit, i) => (
              <DiffView key={i} mode="hunks" before={edit.old} after={edit.new} />
            ))}
          </div>
        </FileCard>
      );
    }
    case 'diff_summary':
    case 'session_finished':
      return null;
    default: {
      if (!event.text) return null;
      return (
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[11px] leading-relaxed text-[#c9d1d9]">
          {event.text}
        </pre>
      );
    }
  }
}

// Карточка файла с заголовком-баром (Cursor-стиль).
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
    <div className="overflow-hidden rounded-md border border-white/10 bg-[#181818]">
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#252526] px-2.5 py-1 font-mono text-[11px] text-[#cccccc]">
        <span className={cn(tone === 'add' ? 'text-[#7ee787]' : 'text-[#e2c08d]')}>{icon}</span>
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
    <div className="mt-3 border-t border-white/10 pt-3">
      {/* Итоговая плашка: статус + стоимость/токены. */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[#8b949e]">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-medium uppercase tracking-wider',
            session.status === 'completed'
              ? 'bg-emerald-500/15 text-emerald-300'
              : session.status === 'canceled'
                ? 'bg-amber-500/15 text-amber-300'
                : 'bg-rose-500/15 text-rose-300',
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
        className="flex w-full items-center gap-1.5 text-xs uppercase tracking-widest text-[#8b949e] hover:text-[#d4d4d4]"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span>Изменения · {files.length} файл(ов)</span>
        <span className="ml-1 normal-case tracking-normal text-[#7ee787]">+{totalAdd}</span>
        <span className="normal-case tracking-normal text-[#f48771]">−{totalDel}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
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
    <div className="overflow-hidden rounded-md border border-white/10 bg-[#181818]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 bg-[#252526] px-2.5 py-1 text-left font-mono text-[11px] text-[#cccccc] hover:bg-white/5"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 truncate">{file.path}</span>
        <span className="ml-auto shrink-0 text-[#7ee787]">+{file.additions}</span>
        <span className="shrink-0 text-[#f48771]">−{file.deletions}</span>
      </button>
      {open && (
        <div className="p-1.5">
          {file.isBinary ? (
            <p className="px-2 py-1 text-[11px] italic text-[#8b949e]">Бинарный файл</p>
          ) : file.unifiedDiff ? (
            <>
              <DiffView mode="unified" unifiedDiff={file.unifiedDiff} />
              {file.truncated && (
                <p className="px-2 pt-1 text-[10px] italic text-[#8b949e]">дифф обрезан по размеру</p>
              )}
            </>
          ) : (
            <p className="px-2 py-1 text-[11px] italic text-[#8b949e]">Нет diff-данных</p>
          )}
        </div>
      )}
    </div>
  );
}
