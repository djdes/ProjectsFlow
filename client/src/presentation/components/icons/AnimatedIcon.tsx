import * as React from 'react';
import Lottie, { type LottieRefCurrentProps } from 'lottie-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Обёртка над Lottie для «живых» иконок (open-source Lottie JSON в репо).
// Гейтится через useMotion(): при выключенных анимациях показываем статичный fallback
// (lucide-иконку) или замороженный первый кадр — никаких движений на pf-no-motion.

type Trigger = 'hover' | 'mount' | 'loop';

interface AnimatedIconProps {
  /** Lottie JSON (импортированный объект анимации). */
  animationData: unknown;
  /** Размер квадрата в px. */
  size?: number;
  className?: string;
  /** Когда проигрывать: по hover (на родителе .group), при монтировании, или зациклить. */
  trigger?: Trigger;
  /** Статичная иконка для режима «без анимаций». */
  fallback?: LucideIcon;
  'aria-label'?: string;
}

export function AnimatedIcon({
  animationData,
  size = 18,
  className,
  trigger = 'hover',
  fallback: Fallback,
  'aria-label': ariaLabel,
}: AnimatedIconProps): React.ReactElement {
  const { animations } = useMotion();
  const ref = React.useRef<LottieRefCurrentProps>(null);

  // Без анимаций — статичный fallback или замороженный первый кадр.
  if (!animations) {
    if (Fallback) {
      return <Fallback className={className} style={{ width: size, height: size }} aria-label={ariaLabel} />;
    }
    return (
      <span className={cn('inline-flex', className)} style={{ width: size, height: size }} aria-label={ariaLabel}>
        <Lottie animationData={animationData} loop={false} autoplay={false} style={{ width: size, height: size }} />
      </span>
    );
  }

  const playFromStart = (): void => {
    ref.current?.goToAndPlay(0, true);
  };
  const stopReset = (): void => {
    ref.current?.goToAndStop(0, true);
  };

  return (
    <span
      className={cn('inline-flex', className)}
      style={{ width: size, height: size }}
      aria-label={ariaLabel}
      onMouseEnter={trigger === 'hover' ? playFromStart : undefined}
      onMouseLeave={trigger === 'hover' ? stopReset : undefined}
    >
      <Lottie
        lottieRef={ref}
        animationData={animationData}
        loop={trigger === 'loop'}
        autoplay={trigger !== 'hover'}
        style={{ width: size, height: size }}
      />
    </span>
  );
}
