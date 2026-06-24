import { motion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { useMotion } from './MotionProvider';

// Мягкий вход страницы при навигации между разделами (fade + лёгкий подъём). Ключуемся по
// ВЕРХНЕМУ сегменту пути — переход между проектами/задачами (один и тот же раздел) не
// ремоунтит страницу и не вызывает лишних рефетчей; анимируются только смены раздела.
// Гейтится useMotion (+ глобальный pf-no-motion / prefers-reduced-motion).
export function PageTransition({ children }: { children: React.ReactNode }): React.ReactElement {
  const { animations } = useMotion();
  const { pathname } = useLocation();
  if (!animations) return <>{children}</>;
  const sectionKey = pathname.split('/')[1] ?? 'home';
  return (
    <motion.div
      key={sectionKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-h-0"
    >
      {children}
    </motion.div>
  );
}
