import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Loader2, Terminal, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { useLiveSession } from '@/presentation/hooks/useLiveSession';
import type { LiveSession } from '@/domain/live/LiveSession';
import type {
  LiveEvent,
  LiveBashPayload,
  LiveFileEditPayload,
  LiveToolUsePayload,
} from '@/domain/live/LiveEvent';
import { CommentBody } from './CommentBody';
import { DiffView } from '@/presentation/components/diff/DiffView';
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

type Props = {
  projectId: string;
  taskId: string;
  // Колбэк наверх: меняется ли running-состояние (для бейджа 🔴 на триггере вкладки).
  onRunningChange?: (running: boolean) => void;
};

export function LiveTab({ projectId, taskId, onRunningChange }: Props): React.ReactElement {
  const { liveRepository } = useContainer();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Сколько событий показываем (кап + «Загрузить ранее»).
  const [visibleCount, setVisibleCount] = useState(DOM_CAP);

  // Список сессий (newest-first). По умолчанию выбираем самую свежую.
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

  // Канбан/сервер сигналит о смене live-сессии — обновляем список (новый прогон).
  useEffect(() => {
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string; taskId?: string }>).detail;
      if (detail?.projectId === projectId && detail?.taskId === taskId) {
        reloadSessions();
      }
    };
    window.addEventListener(LIVE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIVE_CHANGED_EVENT, onChanged);
  }, [projectId, taskId, reloadSessions]);

  const { events, session, fileDiffs, loading, running, reload } = useLiveSession(
    projectId,
    taskId,
    selectedId,
  );

  // Пробрасываем running наверх (бейдж 🔴 на триггере вкладки).
  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  // Скролл-контейнер с auto-scroll вниз, пока юзер не проскроллил вверх.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 80;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    });
  }, [events.length]);

  // При смене сессии — сбрасываем кап и прилипание к низу.
  useEffect(() => {
    setVisibleCount(DOM_CAP);
    stickToBottomRef.current = true;
  }, [selectedId]);

  // Кап DOM: последние N событий + кнопка «Загрузить ранее».
  const shown = useMemo(
    () => (events.length > visibleCount ? events.slice(events.length - visibleCount) : events),
    [events, visibleCount],
  );
  const hiddenCount = events.length - shown.length;

  if (sessionsLoading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-10 text-center text-sm text-muted-foreground">
        <span>Воркер ещё не запускался по этой задаче.</span>
        <span className="text-xs opacity-70">
          Когда Ralph начнёт работу, здесь появится живая лента действий.
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Селектор сессий (попыток). */}
      <div className="flex items-center gap-2 border-b px-1 pb-2">
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
          className="h-7 max-w-full flex-1 truncate rounded-md border bg-background px-2 text-xs"
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              Попытка {s.attempt} · {STATUS_LABEL_RU[s.status]} · {SESSION_TIME_FMT.format(s.startedAt)}
            </option>
          ))}
        </select>
        {running && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-600 dark:text-rose-400">
            <span className="size-1.5 animate-pulse rounded-full bg-rose-500" />
            LIVE
          </span>
        )}
      </div>

      {/* Лента событий — собственный scroll-контейнер. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-2"
      >
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Загрузка ленты…
          </div>
        ) : (
          <>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + DOM_CAP)}
                className="mx-auto block rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50"
              >
                Загрузить ранее ({hiddenCount})
              </button>
            )}
            {shown.map((ev) => (
              <LiveEventRow key={ev.seq} event={ev} />
            ))}
            {events.length === 0 && !running && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Нет событий в этой сессии.
              </p>
            )}
          </>
        )}
      </div>

      {/* Финал сессии: сводка по файлам + полный unified-diff (сворачиваемо). */}
      {session && session.status !== 'running' && fileDiffs.length > 0 && (
        <FinalDiffs files={fileDiffs} />
      )}

      {/* Скрытая кнопка reload для отладки/recovery — не показываем в UI явно. */}
      <button type="button" className="sr-only" onClick={reload} aria-hidden tabIndex={-1}>
        reload
      </button>
    </div>
  );
}

// Один ряд ленты — рендер по kind. assistant_text → markdown (санитайзится);
// bash/tool_error → <pre> plaintext (НИКОГДА не инжектим HTML); tool_use → чип;
// file_edit → DiffView mode=hunks.
function LiveEventRow({ event }: { event: LiveEvent }): React.ReactElement | null {
  switch (event.kind) {
    case 'assistant_text': {
      const text = event.text ?? '';
      if (text.trim().length === 0) return null;
      return (
        <div className="rounded-md border border-transparent px-1 py-0.5">
          <CommentBody body={text} />
        </div>
      );
    }
    case 'bash': {
      const payload = event.payload as LiveBashPayload | null;
      const command = payload?.command ?? event.text ?? '';
      return (
        <div className="overflow-hidden rounded-md border bg-zinc-950 text-zinc-100">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
            <Terminal className="size-3" /> bash
          </div>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2 py-1.5 font-mono text-[11px] leading-relaxed">
            {command}
          </pre>
        </div>
      );
    }
    case 'tool_error': {
      return (
        <div className="overflow-hidden rounded-md border border-rose-500/40 bg-rose-500/5">
          <div className="border-b border-rose-500/30 px-2 py-1 text-[10px] uppercase tracking-wider text-rose-600 dark:text-rose-400">
            ошибка инструмента
          </div>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-2 py-1.5 font-mono text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
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
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
            <Wrench className="size-3" />
            {name}
          </span>
          {brief && <span className="min-w-0 truncate font-mono text-[11px] opacity-80">{brief}</span>}
        </div>
      );
    }
    case 'file_write': {
      const payload = event.payload as { path?: string; content?: string } | null;
      return (
        <div className="space-y-1">
          <div className="font-mono text-[11px] text-muted-foreground">+ {payload?.path ?? 'файл'}</div>
          {payload?.content !== undefined && (
            <DiffView mode="hunks" before="" after={payload.content} />
          )}
        </div>
      );
    }
    case 'file_edit': {
      const payload = event.payload as LiveFileEditPayload | null;
      if (!payload) return null;
      return (
        <div className="space-y-1">
          <div className="font-mono text-[11px] text-muted-foreground">✎ {payload.path}</div>
          <div className="space-y-1">
            {payload.edits.map((edit, i) => (
              <DiffView key={i} mode="hunks" before={edit.old} after={edit.new} />
            ))}
          </div>
        </div>
      );
    }
    case 'diff_summary':
    case 'session_finished':
      // Сводка показывается отдельным блоком FinalDiffs; финал-маркер не рендерим.
      return null;
    default: {
      // Forward-compat: незнакомый kind — показываем сырой текст plaintext, если есть.
      if (!event.text) return null;
      return (
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/30 px-2 py-1 font-mono text-[11px] leading-relaxed">
          {event.text}
        </pre>
      );
    }
  }
}

// Финальные git-диффы: per-file сворачиваемый unified diff.
function FinalDiffs({ files }: { files: import('@/domain/live/LiveFileDiff').LiveFileDiff[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground/70 hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span>Изменения · {files.length} файл(ов)</span>
        <span className="ml-1 normal-case tracking-normal text-emerald-600 dark:text-emerald-400">
          +{totalAdd}
        </span>
        <span className="normal-case tracking-normal text-rose-600 dark:text-rose-400">
          −{totalDel}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {files.map((f) => (
            <FinalFileDiff key={f.path} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FinalFileDiff({
  file,
}: {
  file: import('@/domain/live/LiveFileDiff').LiveFileDiff;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left font-mono text-[11px] hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 truncate">{file.path}</span>
        <span className="ml-auto shrink-0 normal-case text-emerald-600 dark:text-emerald-400">
          +{file.additions}
        </span>
        <span className="shrink-0 text-rose-600 dark:text-rose-400">−{file.deletions}</span>
      </button>
      {open && (
        <>
          {file.isBinary ? (
            <p className="px-2 text-[11px] italic text-muted-foreground">Бинарный файл</p>
          ) : file.unifiedDiff ? (
            <>
              <DiffView mode="unified" unifiedDiff={file.unifiedDiff} />
              {file.truncated && (
                <p className="px-2 text-[10px] italic text-muted-foreground">
                  дифф обрезан по размеру
                </p>
              )}
            </>
          ) : (
            <p className="px-2 text-[11px] italic text-muted-foreground">Нет diff-данных</p>
          )}
        </>
      )}
    </div>
  );
}
