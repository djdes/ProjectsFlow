import { motion } from 'motion/react';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// «Живые» иконки рейла: при активной вкладке оживает не вся иконка целиком (как простой
// подпрыг), а её отдельные части — дверь дома «вырастает», точки в чате «печатают», лупа
// «сканирует», письмо «падает» в лоток. Гейтится useMotion (+ prefers-reduced-motion).

type IconProps = { readonly active?: boolean; readonly className?: string };

const SVG_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

// transform-origin внутри SVG-пути считается от его bbox.
const fillBox = { transformBox: 'fill-box' as const, transformOrigin: 'center' };

export function AnimatedHome({ active, className }: IconProps): React.ReactElement {
  const { animations } = useMotion();
  const live = active && animations;
  return (
    <svg className={className} {...SVG_PROPS} aria-hidden>
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      {/* дверь «вырастает» снизу при активации */}
      <motion.path
        d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
        style={{ transformBox: 'fill-box', transformOrigin: 'center bottom' }}
        initial={false}
        animate={live ? { scaleY: [0.45, 1] } : { scaleY: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
    </svg>
  );
}

export function AnimatedChat({ active, className }: IconProps): React.ReactElement {
  const { animations } = useMotion();
  const live = active && animations;
  return (
    <svg className={className} {...SVG_PROPS} aria-hidden>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      {[8, 12, 16].map((cx, i) => (
        <motion.circle
          key={cx}
          cx={cx}
          cy={12}
          r={1}
          fill="currentColor"
          stroke="none"
          initial={false}
          animate={live ? { opacity: [0.3, 1, 0.3], y: [0, -1.6, 0] } : { opacity: 0.85, y: 0 }}
          transition={live ? { duration: 0.9, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' } : { duration: 0.2 }}
        />
      ))}
    </svg>
  );
}

export function AnimatedInbox({ active, className }: IconProps): React.ReactElement {
  const { animations } = useMotion();
  const live = active && animations;
  return (
    <svg className={className} {...SVG_PROPS} aria-hidden>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      {/* письмо «падает» в лоток */}
      <motion.line
        x1="12"
        y1="5"
        x2="12"
        y2="9.5"
        initial={false}
        animate={live ? { y: [-5, 0], opacity: [0, 1, 0] } : { opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeIn' }}
      />
    </svg>
  );
}

export function AnimatedSearch({ active, className }: IconProps): React.ReactElement {
  const { animations } = useMotion();
  const live = active && animations;
  return (
    <svg className={className} {...SVG_PROPS} aria-hidden>
      {/* лупа «сканирует» — лёгкое круговое смещение + доворот */}
      <motion.g
        style={fillBox}
        initial={false}
        animate={live ? { x: [0, 1.5, -1, 0], y: [0, -1, 1, 0], rotate: [0, 6, -4, 0] } : { x: 0, y: 0, rotate: 0 }}
        transition={live ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </motion.g>
    </svg>
  );
}
