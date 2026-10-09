import { useEffect } from 'react';

// Детерминированный набор частиц (без Math.random — анимация и так выглядит живой
// за счёт разброса позиций/задержек, а рендер остаётся воспроизводимым).
const COLORS = ['oklch(62.31% 0.188 259.81)', 'oklch(72.27% 0.192 149.58)', 'oklch(76.86% 0.1647 70.08)', 'oklch(65.59% 0.212 354.31)', 'oklch(60.56% 0.219 292.72)', 'oklch(63.68% 0.208 25.33)'];
const PIECES = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 53 + 11) % 100,
  delay: (i % 6) * 70,
  color: COLORS[i % COLORS.length] ?? 'oklch(62.31% 0.188 259.81)',
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
    <div aria-hidden className="pointer-events-none fixed inset-x-0 inset-bs-0 z-[60] h-0">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="absolute inset-bs-0 rounded-[1px] animate-[pf-confetti-fall_1.15s_ease-in_forwards]"
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
