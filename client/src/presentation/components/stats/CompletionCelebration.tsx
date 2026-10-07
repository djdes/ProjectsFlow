import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

/** A single confirmation morph; completing a task never scatters particles over work. */
export function CompletionCelebration(): React.ReactElement {
  const { celebrationKey } = useCompletedToday();
  const { animations } = useMotion();
  const [shown, setShown] = useState(false);
  const lastCelebration = useRef(0);
  useEffect(() => {
    const isNew = celebrationKey !== lastCelebration.current;
    lastCelebration.current = celebrationKey;
    if (!animations) { setShown(false); return; }
    if (!celebrationKey || !isNew) return;
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 1400);
    return () => window.clearTimeout(timer);
  }, [celebrationKey, animations]);
  return (
    <AnimatePresence>
      {shown && animations && (
        <motion.div
          role="status"
          aria-label="Задача выполнена"
          initial={{ opacity: 0, scale: 0.92, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 3 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[110] -ml-16 flex h-10 w-32 items-center justify-center gap-2 rounded-full border bg-foreground text-sm font-medium text-background shadow-lg sm:bottom-7"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <motion.path
              d="m5 12 4 4L19 6"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.28, delay: 0.08 }}
            />
          </svg>
          Готово
        </motion.div>
      )}
    </AnimatePresence>
  );
}
