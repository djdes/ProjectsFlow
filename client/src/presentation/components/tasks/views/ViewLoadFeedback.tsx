import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  readonly error: string | null;
  readonly hasData: boolean;
  readonly onRetry: () => Promise<void>;
  readonly label: string;
  readonly className?: string;
};

export function ViewLoadFeedback({
  error,
  hasData,
  onRetry,
  label,
  className,
}: Props): React.ReactElement | null {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const onOnline = (): void => setOnline(true);
    const onOffline = (): void => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const retry = async (): Promise<void> => {
    if (retrying || !online) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  if (!error && online) return null;

  const message = !online
    ? hasData
      ? 'Нет сети. Показываем последние загруженные данные.'
      : 'Нет сети. Подключитесь к интернету и повторите загрузку.'
    : `Не удалось загрузить ${label}: ${error}`;

  if (hasData) {
    return (
      <div
        role={error ? 'alert' : 'status'}
        className={cn(
          'mb-2 flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm',
          online
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100',
          className,
        )}
      >
        {!online && <WifiOff className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1">{message}</span>
        {error && (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying || !online}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium transition-colors hover:bg-foreground/5 disabled:cursor-wait disabled:opacity-60 [@media(hover:none)]:min-h-11"
          >
            {retrying ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Повторить
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border px-6 py-8 text-center',
        online
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100',
        className,
      )}
    >
      {!online && <WifiOff className="size-5" />}
      <p className="text-sm">{message}</p>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying || !online}
        className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
      >
        {retrying ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Повторить
      </button>
    </div>
  );
}
