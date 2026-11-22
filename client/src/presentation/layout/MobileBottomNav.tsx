import { scrollMainToTop } from '@/presentation/components/experience/useAppNavigation';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import {
  AnimatedGlobe,
  AnimatedHome,
  AnimatedUser,
} from '@/presentation/components/nav/AnimatedNavIcons';
import { useUnreadTasks } from '@/presentation/hooks/UnreadTasksProvider';
import { wantsViewTransition } from '@/lib/viewTransition';
import { cn } from '@/lib/utils';

type Gesture = { id: number; x: number; y: number; dragged: boolean };

/** Native buttons for taps/keyboard; a deliberate horizontal drag previews a destination. */
export function MobileBottomNav(): React.ReactElement {
  const navigate = useNavigate();
  const { animations } = useMotion();
  const { pathname } = useLocation();
  const { count } = useUnreadTasks();
  const items = [
    { path: '/', label: 'Входящие', active: pathname === '/', badge: count },
    { path: '/all-tasks', label: 'Все задачи', active: pathname === '/all-tasks', badge: 0 },
    {
      path: '/ai',
      label: 'ИИ',
      active: pathname === '/ai' || pathname.startsWith('/ai/'),
      badge: 0,
    },
    {
      path: '/profile',
      label: 'Профиль',
      active: pathname.startsWith('/profile'),
      badge: 0,
    },
  ];
  const activeIndex = items.findIndex((item) => item.active);
  const innerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const suppressClickRef = useRef(false);

  const restore = (index = activeIndex): void => {
    gestureRef.current = null;
    const indicator = indicatorRef.current;
    if (!indicator) return;
    indicator.style.transition = '';
    indicator.style.opacity = index < 0 ? '0' : '1';
    indicator.style.transform = `translateX(${Math.max(0, index) * 100}%)`;
  };
  const metrics = () => {
    const inner = innerRef.current!;
    const rect = inner.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(inner).paddingLeft);
    return {
      rect,
      left: rect.left + inner.clientLeft + padding,
      width: (inner.clientWidth - padding * 2) / items.length,
    };
  };

  return (
    <nav
      aria-label="Основная навигация"
      // Плавающая капсула без линии сверху (как в приложении Claude), внутри — тот же
      // переключатель, что «Мои / Все». Пока открыта клавиатура, полоса скрыта (globals.css,
      // html[data-pf-keyboard]) — иначе на iOS она едет над клавиатурой и съедает место.
      data-pf-bottom-nav
      className="shrink-0 bg-background px-3 pbe-[max(env(safe-area-inset-bottom,0px),0.5rem)] pbs-1.5"
    >
      <div
        ref={innerRef}
        data-pf-no-edge-swipe
        className="relative mx-auto flex max-w-md touch-pan-y select-none items-stretch rounded-2xl bg-foreground/[0.05] p-1 dark:bg-panel"
        onPointerDown={(event) => {
          if (!event.isPrimary) {
            suppressClickRef.current = true;
            restore();
            return;
          }
          if (event.button !== 0) return;
          suppressClickRef.current = false;
          gestureRef.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dragged: false,
          };
        }}
        onPointerMove={(event) => {
          const gesture = gestureRef.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          const dx = Math.abs(event.clientX - gesture.x);
          const dy = Math.abs(event.clientY - gesture.y);
          if (!gesture.dragged) {
            if (dy > 10 && dy > dx) {
              suppressClickRef.current = true;
              restore();
              return;
            }
            if (dx < 10) return;
            gesture.dragged = true;
            suppressClickRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          const indicator = indicatorRef.current;
          if (!indicator) return;
          const { left, width } = metrics();
          const x = Math.max(
            0,
            Math.min(
              width * (items.length - 1),
              event.clientX - left - width / 2,
            ),
          );
          indicator.style.transition = 'none';
          indicator.style.opacity = '1';
          indicator.style.transform = `translateX(${x}px)`;
        }}
        onPointerUp={(event) => {
          const gesture = gestureRef.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          if (!gesture.dragged) {
            gestureRef.current = null;
            return;
          }
          const { rect, left, width } = metrics();
          if (
            event.clientY < rect.top ||
            event.clientY > rect.bottom ||
            event.clientX < rect.left ||
            event.clientX > rect.right
          ) {
            restore();
            return;
          }
          const index = Math.max(
            0,
            Math.min(
              items.length - 1,
              Math.floor((event.clientX - left) / width),
            ),
          );
          restore(index);
          navigate(items[index]!.path, { viewTransition: wantsViewTransition() });
        }}
        onPointerCancel={() => {
          suppressClickRef.current = true;
          restore();
        }}
        onLostPointerCapture={(event) => {
          // Touch starts with implicit capture on the icon/button. Transferring that
          // capture to this container bubbles a child event; it must not cancel the drag.
          if (event.target === event.currentTarget && gestureRef.current)
            restore();
        }}
        onClickCapture={(event) => {
          if (event.detail > 0 && suppressClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <span
          ref={indicatorRef}
          aria-hidden
          className="pf-nav-glass pointer-events-none absolute inset-y-1 start-1 rounded-lg bg-background shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] transition-[transform,opacity] duration-300 ease-out dark:bg-raised dark:shadow-none"
          style={{
            width: `calc((100% - 0.5rem) / ${items.length})`,
            opacity: activeIndex < 0 ? 0 : 1,
            transform: `translateX(${Math.max(0, activeIndex) * 100}%)`,
          }}
        />
        {items.map((item, index) => (
          <button
            key={item.path}
            type="button"
            data-pf-route={item.path}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
            onClick={() => pathname === item.path ? scrollMainToTop(animations) : navigate(item.path, { viewTransition: wantsViewTransition() })}
            className={cn(
              'relative z-10 flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-2xs min-[360px]:px-2 leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              item.active
                ? 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="relative inline-flex">
              {index === 0 ? (
                <AnimatedHome className="size-5" active={item.active} />
              ) : index === 1 ? (
                <AnimatedGlobe className="size-5" active={item.active} />
              ) : index === 3 ? (
                <AnimatedUser className="size-5" active={item.active} />
              ) : (
                <Sparkles className="size-5" />
              )}
              {item.badge > 0 && (
                <span className="absolute -end-2 -inset-bs-1 inline-flex tabular-nums min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-[14px] text-primary-foreground ring-2 ring-background">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            {/* One line on every phone: at 320px «Все задачи» broke onto two lines and the
                tab bar lost its even baseline. */}
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
