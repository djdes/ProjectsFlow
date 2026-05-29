import { motion } from 'motion/react';

export function DropIndicatorLine(): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0.6 }}
      animate={{ opacity: 1, scaleX: 1 }}
      exit={{ opacity: 0, scaleX: 0.6 }}
      transition={{ duration: 0.13, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none mx-1 flex items-center gap-1.5"
    >
      <div className="size-2 shrink-0 rounded-full border-2 border-primary" />
      <div className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
      <div className="size-2 shrink-0 rounded-full border-2 border-primary" />
    </motion.div>
  );
}
