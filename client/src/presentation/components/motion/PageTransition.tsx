import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useMotion } from './MotionProvider';

/** Keep the same wrapper and children mounted when the motion preference changes. */
export function PageTransition({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const { animations } = useMotion();
  const { pathname } = useLocation();
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!animations || !element.current?.animate) return;
    // Opacity does not create a transformed containing block for fixed task panels.
    const animation = element.current.animate(
      [{ opacity: 0.45 }, { opacity: 1 }],
      {
        duration: 200,
        easing: 'cubic-bezier(.22,1,.36,1)',
      },
    );
    return () => animation.cancel();
  }, [pathname, animations]);
  return (
    <div ref={element} className="h-full min-h-0" data-pf-page>
      {children}
    </div>
  );
}
