// «Я написал — покажи, что написал»: после отправки комментария (сообщения) лента
// докручивается так, чтобы новый элемент был виден целиком. Крутится БЛИЖАЙШИЙ
// прокручиваемый предок элемента, а не заранее выбранный контейнер: на телефоне тело задачи
// имеет натуральную высоту и скроллит общий контейнер окна, в split-раскладке — своя колонка.
// Раньше прокрутка вниз дёргала тело задачи, которое на телефоне не скроллится, и новый
// комментарий уезжал под край экрана.

const BOTTOM_OVERLAY_PX = 160;
const FOLLOW_MS = 1400;

function reducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.classList.contains('pf-no-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The nearest ancestor (or the element itself) that actually scrolls vertically. */
export function scrollContainerOf(el: Element | null): HTMLElement | null {
  for (let node = el as HTMLElement | null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
  }
  const root = document.scrollingElement as HTMLElement | null;
  return root && root.scrollHeight > root.clientHeight + 1 ? root : null;
}

function scrollTo(scroller: HTMLElement, top: number): void {
  scroller.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** Scrolls the container of `el` to its very end (the latest item of a feed). */
export function scrollToEnd(el: Element | null): void {
  requestAnimationFrame(() => {
    const scroller = scrollContainerOf(el);
    if (scroller) scrollTo(scroller, scroller.scrollHeight);
  });
}

/**
 * Brings the freshly created element with this DOM id into view once React has rendered it.
 * The last item of its feed (a new comment, the usual case) — the feed goes to its very end:
 * the composer and the tab bar may lie over the bottom of the scroll area, and the feed keeps
 * a bottom padding exactly for them. An item in the middle (a reply in a thread) — centred if
 * it is not in view. `fallback` is scrolled to the end when the element never shows up.
 * Items of one feed share the id prefix before the first «-» («comment-…»).
 */
export function revealNewItem(id: string, fallback?: Element | null): void {
  if (typeof document === 'undefined') return;
  const prefix = id.includes('-') ? `${id.slice(0, id.indexOf('-') + 1)}` : id;
  let tries = 0;
  const step = (): void => {
    const el = document.getElementById(id);
    if (!el) {
      tries += 1;
      if (tries < 12) requestAnimationFrame(step);
      else if (fallback) scrollToEnd(fallback);
      return;
    }
    const scroller = scrollContainerOf(el);
    if (!scroller) return;
    const feed = document.querySelectorAll(`[id^="${prefix}"]`);
    const isLast = feed[feed.length - 1] === el;
    if (!isLast) {
      const isRoot = scroller === document.scrollingElement;
      const box = isRoot ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      // The lower part of the area may be under the composer: count it as hidden.
      if (rect.top < box.top || rect.bottom > box.bottom - BOTTOM_OVERLAY_PX) {
        el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      return;
    }
    let done = false;
    const toEnd = (): void => scrollTo(scroller, scroller.scrollHeight);
    toEnd();
    // A smooth scroll is cancelled by any other scroll on the way (the composer clearing and
    // keeping its caret in view): send it again until the feed really is at its end.
    const atEnd = (): boolean => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4;
    const retry = (): void => {
      if (!done && !atEnd()) toEnd();
    };
    const retries = [300, 700, 1100].map((ms) => window.setTimeout(retry, ms));
    // The new item keeps growing for a moment (lazy body, attachments, the composer folding
    // back after send): stay at the end for a short while, unless the person takes the feed.
    if (typeof ResizeObserver === 'undefined') return;
    const stop = (): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      scroller.removeEventListener('touchstart', stop);
      scroller.removeEventListener('wheel', stop);
      window.clearTimeout(timer);
      retries.forEach((t) => window.clearTimeout(t));
    };
    const observer = new ResizeObserver(() => toEnd());
    observer.observe(el);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener('touchstart', stop, { passive: true });
    scroller.addEventListener('wheel', stop, { passive: true });
    const timer = window.setTimeout(stop, FOLLOW_MS);
  };
  requestAnimationFrame(step);
}
