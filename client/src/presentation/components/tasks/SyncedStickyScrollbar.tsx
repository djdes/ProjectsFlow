import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Горизонтальный скролл-бар, закреплённый снизу вьюпорта (Notion-style): всегда виден и
 * НЕ исчезает при вертикальном скролле страницы (в отличие от родного scrollbar доски,
 * который живёт у нижнего края высокой колонки — ниже сгиба). Синхронизирует `scrollLeft`
 * с целевым контейнером (доской канбана) в обе стороны. Рендерится только при переполнении.
 *
 * Кладётся сиблингом сразу после прокручиваемого контейнера, внутри вертикального
 * скролл-порта страницы — тогда `sticky bottom` прилипает к низу вьюпорта.
 */
export function SyncedStickyScrollbar({
  targetRef,
  className,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  className?: string;
}): React.ReactElement | null {
  const trackRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const measure = (): void => {
      setScrollWidth(target.scrollWidth);
      setClientWidth(target.clientWidth);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(target);
    // Колонки/задачи добавляются и удаляются — пересчитываем ширину контента.
    const mo = new MutationObserver(measure);
    mo.observe(target, { childList: true, subtree: true });

    const onTargetScroll = (): void => {
      if (syncing.current) return;
      const track = trackRef.current;
      if (!track) return;
      syncing.current = true;
      track.scrollLeft = target.scrollLeft;
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    };
    target.addEventListener('scroll', onTargetScroll, { passive: true });
    window.addEventListener('resize', measure);

    return () => {
      ro.disconnect();
      mo.disconnect();
      target.removeEventListener('scroll', onTargetScroll);
      window.removeEventListener('resize', measure);
    };
  }, [targetRef]);

  const onTrackScroll = (): void => {
    if (syncing.current) return;
    const target = targetRef.current;
    const track = trackRef.current;
    if (!target || !track) return;
    syncing.current = true;
    target.scrollLeft = track.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  // +1 — страховка от сабпиксельных расхождений scrollWidth/clientWidth.
  if (scrollWidth <= clientWidth + 1) return null;

  return (
    <div
      className={cn(
        // Прилипает к низу вертикального скролл-порта. z над колонками, но под плавающим
        // композером/таб-баром (у тех z-30+). Отрицательный top-margin убирает лишний зазор.
        // Только десктоп: на мобиле колонки листаются свайпом (snap) + внизу фикс. таб-бар.
        'pointer-events-none sticky bottom-0 z-20 -mt-2 hidden sm:block',
        className,
      )}
      aria-hidden
    >
      <div
        ref={trackRef}
        onScroll={onTrackScroll}
        className="pf-scroll-visible pointer-events-auto w-full overflow-x-auto overflow-y-hidden"
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
    </div>
  );
}
