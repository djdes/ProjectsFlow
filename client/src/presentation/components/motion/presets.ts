import type { Transition, Variants } from 'motion/react';

// Переиспользуемые минималистичные пресеты анимаций (Framer / motion-one).
// Всегда гейтить через useMotion(): при выключенных анимациях передавать initial={false}
// или transition={INSTANT}, чтобы на pf-no-motion всё срабатывало мгновенно.

/** Мягкая «ease-out» кривая Notion-стиля. */
export const EASE_OUT: Transition['ease'] = [0.22, 1, 0.36, 1];

export const INSTANT: Transition = { duration: 0 };

/** Появление снизу вверх с лёгким fade — для строк списков, карточек, поповеров. */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.14, ease: EASE_OUT } },
};

/** Мягкое «всплывание» — для меню/поповеров/тултипов. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.16, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.1, ease: EASE_OUT } },
};

/** Контейнер для каскадного появления детей (stagger). */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

/** Лёгкий подъём по hover — для интерактивных карточек. */
export const hoverLift: Variants = {
  rest: { y: 0 },
  hover: { y: -2, transition: { duration: 0.18, ease: EASE_OUT } },
};
