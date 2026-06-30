import { useState } from 'react';
import { motion } from 'motion/react';
import { TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { formatUsd } from './usageFormat';
import { useUsage } from './UsageProvider';
import { useUsageDialog } from './UsageDialogProvider';
import { computeThreshold } from './useUsageThreshold';

const DISMISS_KEY = 'pf:usage-banner-dismissed';

// Висящий закрываемый баннер при низком/исчерпанном лимите. Клик → окно «Использование».
// Закрытие запоминает «ключ эпизода»: при сбросе окна / эскалации появится снова (см. computeThreshold).
export function UsageBanner(): React.ReactElement | null {
  const { usage } = useUsage();
  const usageDialog = useUsageDialog();
  const { animations } = useMotion();
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });

  const { level, key } = computeThreshold(usage);
  if (level === 'none' || !usage || dismissedKey === key) return null;

  const blocked = level === 'blocked';
  const h = usage.fiveHour;
  const w = usage.sevenDay;
  const weeklyLow = w.capUsd != null && w.remainingUsd != null && w.remainingUsd <= w.capUsd * 0.05;

  const text = blocked
    ? 'Лимит исчерпан — AI-задачи приостановлены до сброса'
    : weeklyLow && w.remainingUsd != null
      ? `Недельный лимит почти исчерпан — осталось ${formatUsd(w.remainingUsd)}`
      : h.remainingUsd != null
        ? `5-часовой лимит почти исчерпан — осталось ${formatUsd(h.remainingUsd)}`
        : 'Лимит почти исчерпан';

  const dismiss = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation();
    try {
      localStorage.setItem(DISMISS_KEY, key);
    } catch {
      /* localStorage недоступен — не критично */
    }
    setDismissedKey(key);
  };

  return (
    <motion.div
      role="status"
      initial={animations ? { opacity: 0, y: 16 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: animations ? 0.35 : 0, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'fixed left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2',
        // Над мобильным таб-баром (safe-area), на десктопе — у нижнего края по центру.
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4',
      )}
    >
      <button
        type="button"
        onClick={() => usageDialog.open()}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm shadow-lg backdrop-blur',
          blocked
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        )}
      >
        <TriangleAlert className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
        <span className="shrink-0 text-xs underline-offset-2 opacity-70 group-hover:underline">
          Подробнее
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Скрыть"
          onClick={dismiss}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              dismiss(e);
            }
          }}
          className="grid size-5 shrink-0 place-items-center rounded hover:bg-foreground/10"
        >
          <X className="size-3.5" />
        </span>
      </button>
    </motion.div>
  );
}
