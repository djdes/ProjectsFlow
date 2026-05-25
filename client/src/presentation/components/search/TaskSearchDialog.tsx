import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/domain/task/Task';
import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';

const statusLabel: Record<TaskStatus, string> = {
  backlog: 'Бэклог',
  todo: 'To Do',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};

const DEBOUNCE_MS = 250;

export function TaskSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { searchTasks } = useContainer();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Сброс состояния при каждом открытии — палитра всегда стартует чистой.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      // Radix фокусит контент; даём ему кадр, затем фокусим input.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced-поиск. Гонки гасим флагом cancelled — отменяем результат устаревшего запроса.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchTasks
        .execute(trimmed)
        .then((res) => {
          if (cancelled) return;
          setResults(res);
          setActiveIndex(0);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchTasks]);

  function select(result: TaskSearchResult): void {
    onOpenChange(false);
    navigate(`/projects/${result.projectId}`);
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[activeIndex];
      if (picked) select(picked);
    }
  }

  const trimmed = query.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Поиск по задачам</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Поиск по задачам всех проектов…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {loading && (
            <li className="px-4 py-3 text-sm text-muted-foreground">Поиск…</li>
          )}
          {!loading && trimmed.length >= 2 && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">Ничего не найдено.</li>
          )}
          {!loading && trimmed.length < 2 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              Введите минимум 2 символа.
            </li>
          )}
          {results.map((r, i) => (
            <li key={r.taskId}>
              <button
                type="button"
                onClick={() => select(r)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  'flex w-full flex-col gap-0.5 px-4 py-2 text-left transition-colors',
                  i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                )}
              >
                <span className="line-clamp-1 text-sm">{r.excerpt || '—'}</span>
                <span className="text-xs text-muted-foreground">
                  {r.projectName} · {statusLabel[r.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
