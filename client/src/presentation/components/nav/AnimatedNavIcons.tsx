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

export function AnimatedFolder({ active, className }: IconProps): React.ReactElement {
  const { animations } = useMotion();
  const live = active && animations;
  return (
    <svg className={className} {...SVG_PROPS} aria-hidden>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      {/* столбики канбана «вырастают» при активации */}
      {[
        { x: 8, h: 4 },
        { x: 12, h: 2 },
        { x: 16, h: 6 },
      ].map((b, i) => (
        <motion.path
          key={b.x}
          d={`M${b.x} 10v${b.h}`}
          style={{ transformBox: 'fill-box', transformOrigin: 'center top' }}
          initial={false}
          animate={live ? { scaleY: [0.2, 1] } : { scaleY: 1 }}
          transition={{ duration: 0.4, delay: i * 0.08, ease: 'easeOut' }}
        />
      ))}
    </svg>
  );
}

export function AnimatedBell({ active, className }: IconProps): React.ReactElement {
  const { animations } = useMotion();
  const live = active && animations;
  return (
    <svg className={className} {...SVG_PROPS} aria-hidden>
      {/* «звенит» — корпус качается от точки подвеса (сверху), язычок остаётся на месте */}
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center top' }}
        initial={false}
        animate={live ? { rotate: [0, 12, -10, 7, -4, 0] } : { rotate: 0 }}
        transition={{ duration: 0.8, ease: 'easeInOut' }}
      >
        <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326z" />
      </motion.g>
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    </svg>
  );
}

export function AnimatedUser({ active, className }: IconProps): React.ReactElement {
  const { animations } = useMotion();
  const live = active && animations;
  return (
    <svg className={className} {...SVG_PROPS} aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      {/* голова слегка «кивает» при активации */}
      <motion.circle
        cx="12"
        cy="7"
        r="4"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={false}
        animate={live ? { y: [0, -1.5, 0], scale: [1, 1.06, 1] } : { y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
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
