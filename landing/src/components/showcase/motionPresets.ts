import { useReducedMotion, type Transition } from 'framer-motion';

// Пружина интерфейса витрины: перелёт ~1–2 %, без «пружинки» (затухание ≈ 0.83).
export const UI_SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34 };
// Высота раскрытия — без перелёта: строка не должна подпрыгивать.
export const HEIGHT_SPRING: Transition = { type: 'spring', stiffness: 380, damping: 38 };
const FADE: Transition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };

type Swap = {
  initial: Record<string, number | string>;
  animate: Record<string, number | string>;
  exit: Record<string, number | string>;
  transition: Transition;
};

/** Смена содержимого: новое входит из лёгкого размытия, старое уходит в него. */
export function useSwap(distance = 8, axis: 'x' | 'y' = 'y'): Swap {
  const reduce = useReducedMotion();
  if (reduce) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } };
  }
  return {
    initial: { opacity: 0, [axis]: distance, filter: 'blur(6px)' },
    animate: { opacity: 1, [axis]: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, [axis]: -distance * 0.75, filter: 'blur(6px)' },
    transition: { ...UI_SPRING, opacity: FADE, filter: FADE },
  };
}
