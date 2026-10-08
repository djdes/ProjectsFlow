import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { preloadPage } from '@/presentation/app/pageModules';

export function scrollMainToTop(animate: boolean): void {
  document
    .querySelector('main[data-pf-main]')
    ?.scrollTo({ top: 0, behavior: animate ? 'smooth' : 'instant' });
}

/** Positions contain no page data and disappear with the authenticated shell. */
export function useAppNavigation(desktop: boolean): void {
  const location = useLocation();
  const navigation = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>('main[data-pf-main]');
    if (!main) return;
    const savedPositions = positions.current;
    const pathChanged = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    const stored = savedPositions.get(location.key);
    const target =
      navigation === 'POP' && stored !== undefined
        ? stored
        : pathChanged
          ? 0
          : main.scrollTop;
    let restoring = target > 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restore = (): void => {
      main.scrollTop = target;
      if (
        main.scrollHeight - main.clientHeight >= target &&
        !main.querySelector('[data-pf-loading="true"]')
      )
        stop();
    };
    const observer = new ResizeObserver(() => {
      if (restoring) restore();
    });
    const mutations = new MutationObserver(() => {
      if (restoring) restore();
    });
    const stop = (): void => {
      restoring = false;
      observer.disconnect();
      mutations.disconnect();
      if (timer) clearTimeout(timer);
    };
    const cancel = (): void => stop();
    const save = (): void => {
      if (!restoring) savedPositions.set(location.key, main.scrollTop);
    };
    main.scrollTop = target;
    savedPositions.set(location.key, target);
    if (restoring) {
      observer.observe(main);
      for (const child of main.children) observer.observe(child);
      mutations.observe(main, { childList: true, subtree: true });
      timer = setTimeout(stop, 8000);
      restore();
    }
    main.addEventListener('scroll', save, { passive: true });
    main.addEventListener('wheel', cancel, { passive: true });
    main.addEventListener('touchstart', cancel, { passive: true });
    main.addEventListener('keydown', cancel);
    return () => {
      // Read from scroll events, not the newly committed route's shorter DOM.
      if (restoring) savedPositions.set(location.key, target);
      if (savedPositions.size > 80)
        savedPositions.delete(savedPositions.keys().next().value!);
      stop();
      main.removeEventListener('scroll', save);
      main.removeEventListener('wheel', cancel);
      main.removeEventListener('touchstart', cancel);
      main.removeEventListener('keydown', cancel);
    };
  }, [location.key, location.pathname, navigation, desktop]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const intent = (event: Event): void => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('a[href], [data-pf-route]')
          : null;
      const href = target?.getAttribute('href') ?? target?.dataset.pfRoute;
      if (!href) return;
      if (timer) clearTimeout(timer);
      if (event.type === 'pointerover')
        timer = setTimeout(() => preloadPage(href), 100);
      else preloadPage(href);
    };
    const leave = (): void => {
      if (timer) clearTimeout(timer);
    };
    document.addEventListener('pointerover', intent, { passive: true });
    document.addEventListener('pointerout', leave, { passive: true });
    document.addEventListener('pointerdown', intent, { passive: true });
    document.addEventListener('focusin', intent);
    return () => {
      leave();
      document.removeEventListener('pointerover', intent);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerdown', intent);
      document.removeEventListener('focusin', intent);
    };
  }, []);
}
