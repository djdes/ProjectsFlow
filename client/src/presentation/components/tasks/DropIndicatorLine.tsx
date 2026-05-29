import { motion } from 'motion/react';

const EASE = [0.22, 1, 0.36, 1] as const;
const DURATION = 0.15; // 150 ms — slightly longer than before to let the gap open visually

/**
 * Horizontal accent line shown between kanban cards during drag-and-drop.
 * Animates both opacity/scaleX (the line itself) and height/padding (the space
 * it occupies), so neighboring cards spread apart smoothly instead of jumping.
 */
export function DropIndicatorLine(): React.ReactElement {
  return (
    <motion.div
      // Outer wrapper: animates the vertical space the indicator occupies.
      // `overflow: hidden` keeps the inner line clipped while height grows.
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: DURATION, ease: EASE }}
      className="pointer-events-none overflow-hidden"
    >
      <motion.div
        // Inner: the visible line with scaleX entrance.
        initial={{ scaleX: 0.6 }}
        animate={{ scaleX: 1 }}
        exit={{ scaleX: 0.6 }}
        transition={{ duration: DURATION, ease: EASE }}
        className="mx-1 flex items-center gap-1.5 py-0.5"
      >
        <div className="size-2 shrink-0 rounded-full border-2 border-primary" />
        <div className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
        <div className="size-2 shrink-0 rounded-full border-2 border-primary" />
      </motion.div>
    </motion.div>
  );
}
