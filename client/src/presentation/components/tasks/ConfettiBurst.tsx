import { useEffect } from 'react';

// Детерминированный набор частиц (без Math.random — анимация и так выглядит живой
// за счёт разброса позиций/задержек, а рендер остаётся воспроизводимым).
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];
const PIECES = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 53 + 11) % 100,
  delay: (i % 6) * 70,
  color: COLORS[i % COLORS.length] ?? '#3b82f6',
  width: 6 + (i % 3) * 3,
  height: 5 + ((i + 1) % 3) * 2,
}));

// Короткий «дождь конфетти» при переносе задачи в «Готово» (Linear-style микро-награда).
// Уважает reduced-motion и ручной toggle анимаций (pf-no-motion) — тогда не рендерится.
export function ConfettiBurst({ onDone }: { onDone: () => void }): React.ReactElement | null {
  useEffect(() => {
    const t = window.setTimeout(onDone, 1400);
    return () => window.clearTimeout(t);
  }, [onDone]);

  const reduceMotion =
    typeof window !== 'undefined' &&
    (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.classList.contains('pf-no-motion'));
  if (reduceMotion) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 rounded-[1px] animate-[pf-confetti-fall_1.15s_ease-in_forwards]"
          style={{
            left: `${p.left}%`,
            width: p.width,
            height: p.height,
            background: p.color,
            animationDelay: `${p.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}
