import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/presentation/hooks/useOnlineStatus';

// The offline pill: the app was opened from the version saved by the service worker, or the
// connection dropped while working. Mounted at the root (main.tsx), so it is also visible on the
// session check error screen. Floats above the phone's bottom navigation and home indicator like
// the other floating pills; taps pass through it. On phones the right edge is left free for the
// round "new task" button of the inbox.
export function OfflineBanner(): React.ReactElement | null {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-pf-offline-banner
      className="pointer-events-none fixed inset-x-0 inset-be-[calc(4.5rem_+_env(safe-area-inset-bottom,0px))] z-[120] flex justify-start ps-[max(0.75rem,env(safe-area-inset-left,0px))] pe-[calc(5.5rem_+_env(safe-area-inset-right,0px))] md:inset-be-4 md:justify-center md:pe-[max(0.75rem,env(safe-area-inset-right,0px))]"
    >
      <div className="flex min-w-0 max-w-md items-start gap-2 rounded-2xl bg-foreground px-3.5 py-2 text-ui text-background shadow-float">
        <WifiOff className="mbs-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0">
          <span className="font-semibold">Нет сети</span> — показываем последние загруженные данные, изменения не сохранятся
        </p>
      </div>
    </div>
  );
}
