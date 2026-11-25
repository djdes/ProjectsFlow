// Scroll-linked motion of the main page (styles in landing/src/styles/home.css, system in
// landing/DESIGN.md). The script only writes CSS custom properties; CSS turns them into
// transform/opacity. Under prefers-reduced-motion: reduce nothing is wired: the root gets
// .pf--static and the page stays still. Without JavaScript the page is static as well.
//
// Properties written (all 0…1 unless noted):
//   .hero --h          first screen recedes under the board window
//   .win --w           the window straightens out of its tilt
//   .statement__text --wp   words of the statement light up one by one
//   .step --c          a step card is covered by the next one (stacking)
//   .pin --pp, .pin__track --x (px), .pin --pin-h / --pin-dist (px)   pinned sideways strip
//   .foot --r          footer opens from under the page
//   text --t           text reveal, only where CSS animation-timeline is unsupported

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function put(el: HTMLElement | null, name: string, value: number): void {
  el?.style.setProperty(name, String(Math.round(value * 1000) / 1000));
}

export function initHomeMotion(root: HTMLElement): () => void {
  const one = (selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector);
  const all = (selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    root.classList.add('pf--static');
    return () => root.classList.remove('pf--static');
  }
  root.classList.add('pf--motion');

  const hero = one('.hero');
  const light = one('.hero__light');
  const win = one('.win');
  const words = one('.statement__text');
  const steps = all('.step');
  const pin = one('.pin');
  const view = one('.pin__view');
  const track = one('.pin__track');
  const main = one('main');
  const foot = one('.foot');

  // Text reveal: CSS scroll-driven animation where supported, otherwise --t from here.
  const cssScroll = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()');
  let texts: HTMLElement[] = [];
  if (!cssScroll) {
    root.classList.add('pf--tjs');
    texts = all('.rv h2, .rv h3, .rv p, .rv .plan__list li').filter(
      (el) => !el.closest('[aria-hidden="true"], .win, .statement__text'),
    );
  }

  let pinH = 0;
  let pinDist = 0;

  function measure(): void {
    if (!pin || !track || !view) return;
    const nextH = Math.max(560, Math.min(window.innerHeight, 920));
    const nextDist = Math.max(0, track.scrollWidth - view.clientWidth);
    if (nextH === pinH && nextDist === pinDist) return;
    pinH = nextH;
    pinDist = nextDist;
    pin.style.setProperty('--pin-h', `${pinH}px`);
    pin.style.setProperty('--pin-dist', `${pinDist}px`);
  }

  function update(): void {
    const vh = window.innerHeight;
    // Read every rect first, then write: no layout between writes.
    const y = -root.getBoundingClientRect().top;
    const winTop = win?.getBoundingClientRect().top ?? 0;
    const wordsRect = words?.getBoundingClientRect();
    const stepRects = steps.map((el) => el.getBoundingClientRect());
    const pinRect = pin?.getBoundingClientRect();
    const footH = foot?.getBoundingClientRect().height ?? 0;
    const mainBottom = main?.getBoundingClientRect().bottom ?? 0;
    const textRects = texts.map((el) => el.getBoundingClientRect());

    put(hero, '--h', clamp01(y / (vh * 0.85)));
    put(win, '--w', clamp01((vh - winTop) / (vh * 0.78)));
    if (wordsRect) put(words, '--wp', clamp01((vh * 0.9 - wordsRect.top) / (vh * 0.55 + wordsRect.height * 0.6)));
    steps.forEach((el, i) => {
      const cur = stepRects[i];
      const next = stepRects[i + 1];
      put(el, '--c', next ? clamp01(1 - (next.top - cur.top) / Math.max(1, cur.height)) : 0);
    });
    if (pin && track && pinRect) {
      const pp = clamp01(-pinRect.top / Math.max(1, pinRect.height - (pinH || vh)));
      track.style.setProperty('--x', `${(-pp * pinDist).toFixed(1)}px`);
      put(pin, '--pp', pp);
    }
    if (foot && main) put(foot, '--r', clamp01((vh - mainBottom) / Math.max(1, Math.min(footH, vh))));
    texts.forEach((el, i) => put(el, '--t', clamp01((vh - textRects[i].top) / Math.max(1, textRects[i].height * 0.8))));
  }

  let frame = 0;
  const onScroll = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  const onResize = (): void => {
    measure();
    onScroll();
  };

  // Soft light follows the mouse over the first screen (touch screens keep it centred).
  let lightFrame = 0;
  let point: [number, number] = [0, 0];
  const placeLight = (x: number, y: number): void => {
    if (light) light.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };
  const centerLight = (): void => {
    const r = hero?.getBoundingClientRect();
    if (r && r.width) placeLight(r.width / 2, Math.min(r.height * 0.34, 340));
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !hero) return;
    const r = hero.getBoundingClientRect();
    point = [event.clientX - r.left, event.clientY - r.top];
    if (lightFrame) return;
    lightFrame = requestAnimationFrame(() => {
      lightFrame = 0;
      placeLight(point[0], point[1]);
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  hero?.addEventListener('pointermove', onPointerMove);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
  observer?.observe(root);

  centerLight();
  measure();
  update();
  void document.fonts?.ready.then(() => {
    centerLight();
    measure();
    update();
  });

  return () => {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(lightFrame);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    hero?.removeEventListener('pointermove', onPointerMove);
    observer?.disconnect();
    root.classList.remove('pf--motion', 'pf--tjs');
  };
}
