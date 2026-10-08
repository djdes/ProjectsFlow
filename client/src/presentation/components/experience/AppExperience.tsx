import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { ArrowDown, Check, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  mayStartPull,
  pullRefreshDistance,
  PULL_REFRESH_THRESHOLD,
} from '@/lib/pullRefreshGesture';
import {
  canRefreshPage,
  isRefreshingPage,
  refreshPage,
  refreshRevision,
  subscribeRefresh,
} from './refreshRegistry';

export function AppExperience({
  desktop,
}: {
  desktop: boolean;
}): React.ReactElement {
  const { pathname } = useLocation();
  useSyncExternalStore(subscribeRefresh, refreshRevision);
  const supported = canRefreshPage(pathname);
  const refreshing = isRefreshingPage(pathname);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [reconnected, setReconnected] = useState(false);
  const [distance, setDistance] = useState(0);
  const [done, setDone] = useState(false);
  const [main, setMain] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeScope = useRef(pathname);
  useEffect(() => {
    activeScope.current = pathname;
    setDone(false);
    setDistance(0);
    setReconnected(false);
    if (timer.current) clearTimeout(timer.current);
  }, [pathname]);
  useEffect(() => {
    setMain(document.querySelector('main[data-pf-main]'));
  }, [desktop]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const refresh = useCallback(async (): Promise<void> => {
    setDone(false);
    if (timer.current) clearTimeout(timer.current);
    if (!navigator.onLine) {
      toast.error('Нет соединения. Обновим данные, когда связь вернётся.');
      return;
    }
    const scope = pathname;
    try {
      await refreshPage(scope);
      if (activeScope.current !== scope) return;
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1400);
    } catch (error) {
      if (activeScope.current === scope) toast.error((error as Error).message);
    } finally {
      if (activeScope.current === scope) setDistance(0);
    }
  }, [pathname]);

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const offline = (): void => {
      setOnline(false);
      setReconnected(false);
      setDone(false);
      setDistance(0);
    };
    const reconnect = (): void => {
      setOnline(true);
      setReconnected(true);
      void refresh();
      if (hide) clearTimeout(hide);
      hide = setTimeout(() => setReconnected(false), 2500);
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', reconnect);
    return () => {
      if (hide) clearTimeout(hide);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', reconnect);
    };
  }, [refresh]);

  useEffect(() => {
    if (!main || desktop || !supported || refreshing) return;
    let start: { x: number; y: number } | null = null;
    let pull = 0;
    const cancel = (): void => {
      start = null;
      pull = 0;
      setDistance(0);
    };
    const down = (event: TouchEvent): void => {
      if (
        event.touches.length !== 1 ||
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      ) {
        cancel();
        return;
      }
      if (
        !(event.target instanceof Element) ||
        !mayStartPull(event.target, main)
      )
        return;
      const touch = event.touches[0]!;
      start = { x: touch.clientX, y: touch.clientY };
    };
    const move = (event: TouchEvent): void => {
      if (!start) return;
      if (event.touches.length !== 1 || main.scrollTop > 1) {
        cancel();
        return;
      }
      const touch = event.touches[0]!;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (dy < -6 || (Math.abs(dx) > 12 && Math.abs(dx) > dy)) {
        cancel();
        return;
      }
      pull = pullRefreshDistance(dx, dy);
      if (pull > 4 && event.cancelable) event.preventDefault();
      setDistance(pull);
    };
    const up = (): void => {
      const commit = pull >= PULL_REFRESH_THRESHOLD;
      cancel();
      if (commit) void refresh();
    };
    main.addEventListener('touchstart', down, { passive: true });
    main.addEventListener('touchmove', move, { passive: false });
    main.addEventListener('touchend', up);
    main.addEventListener('touchcancel', cancel);
    return () => {
      main.removeEventListener('touchstart', down);
      main.removeEventListener('touchmove', move);
      main.removeEventListener('touchend', up);
      main.removeEventListener('touchcancel', cancel);
    };
  }, [main, desktop, supported, refreshing, refresh]);

  const visible = distance > 4 || refreshing || done;
  return (
    <>
      {main &&
        supported &&
        createPortal(
          <div className="pf-refresh-anchor">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || !online}
              aria-label="Обновить страницу"
              title="Обновить данные без перезагрузки"
              className={cn('pf-pull-refresh', visible && 'is-visible')}
              style={
                {
                  '--pf-pull-distance': `${refreshing || done ? 12 : Math.max(0, distance - 36)}px`,
                } as React.CSSProperties
              }
            >
              {refreshing ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : done ? (
                <Check className="size-4 text-success" />
              ) : (
                <ArrowDown
                  className="size-4"
                  style={{
                    transform:
                      distance >= PULL_REFRESH_THRESHOLD
                        ? 'rotate(180deg)'
                        : undefined,
                  }}
                />
              )}
              <span aria-live="polite">
                {refreshing
                  ? 'Обновляем…'
                  : done
                    ? 'Обновлено'
                    : distance >= PULL_REFRESH_THRESHOLD
                      ? 'Отпустите, чтобы обновить'
                      : 'Потяните для обновления'}
              </span>
            </button>
          </div>,
          main,
        )}
      {(!online || reconnected) && (
        <div role="status" className="pf-connection-notice">
          {online ? (
            <Wifi className="size-4 text-success" />
          ) : (
            <WifiOff className="size-4" />
          )}
          <span>
            {online
              ? 'Соединение восстановлено'
              : 'Нет соединения с интернетом'}
          </span>
        </div>
      )}
    </>
  );
}
