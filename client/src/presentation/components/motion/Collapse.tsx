import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';

// Плавное сворачивание/разворачивание по высоте + прозрачности (пружина). Единый паттерн
// для всех коллапс-секций (Избранное / Мои проекты / Архивные / Недавнее), чтобы они
// открывались так же мягко, как «Недавнее», а не появлялись резко. Гейтится useMotion
// (+ глобальный pf-no-motion / prefers-reduced-motion → мгновенно).
export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const { animations } = useMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={animations ? { height: 0, opacity: 0 } : false}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={animations ? { type: 'spring', stiffness: 420, damping: 36 } : { duration: 0 }}
          className={cn('overflow-hidden', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
