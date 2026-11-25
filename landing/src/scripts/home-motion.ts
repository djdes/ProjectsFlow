// Scroll-linked motion and layout fixes of the main page (styles in landing/src/styles/home.css,
// system in landing/DESIGN.md). The script only writes CSS custom properties and classes; CSS turns
// them into transform/opacity. Without JavaScript the page is static and fully readable.
//
// Always (also under prefers-reduced-motion: reduce, root class .pf--static):
//   .hero --hero-top (px)  a first screen taller than the window scrolls to its bottom, then stays
//   .pf--foot-flow         a footer taller than the window flows with the page
//   anchor settling        after fonts and the pinned strip change the layout, /#section is re-aligned
// Motion only (root class .pf--motion), all 0…1 unless noted:
//   .hero --h          first screen recedes under the board window
//   .statement__text .lw.on words of the statement light up from blur one by one
//   .step --c          a step card is covered by the next one (stacking)
//   .pin --pp, .pin__track --x (px), .pin --pin-dist (px)   pinned sideways strip
//   .foot --r          footer opens from under the page
//   .rw / .rb .is-in   headings emerge from blur word by word, blocks as a whole, once they enter
//                      the screen (IntersectionObserver; CSS transitions do the rest)

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function put(el: HTMLElement | null, name: string, value: number): void {
  el?.style.setProperty(name, String(Math.round(value * 1000) / 1000));
}

export function initHomeMotion(root: HTMLElement): () => void {
  const one = (selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector);
  const all = (selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add(reduce ? 'pf--static' : 'pf--motion');

  const hero = one('.hero');
  const light = one('.hero__light');
  const words = one('.statement__text');
  const steps = all('.step');
  const pin = one('.pin');
  const pinIn = one('.pin__in');
  const view = one('.pin__view');
  const track = one('.pin__track');
  const main = one('main');
  const foot = one('.foot');

  // Height of the small viewport (100svh). Unlike innerHeight it stays put when the iOS Safari
  // toolbar collapses, so layout decisions do not make the page jump.
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;inset-block-start:0;inline-size:0;block-size:100vh;block-size:100svh;visibility:hidden;pointer-events:none';
  root.append(probe);
  const stableHeight = (): number => probe.offsetHeight || window.innerHeight;

  // Words and blocks emerge from blur once they enter the screen: .is-in, then CSS transitions.
  const statementWords = all('.statement__text .lw');
  let litCount = -1;
  let revealer: IntersectionObserver | null = null;
  if (!reduce) {
    const toReveal = all('.rw, .rb');
    if (typeof IntersectionObserver === 'undefined') {
      toReveal.forEach((el) => el.classList.add('is-in'));
    } else {
      revealer = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        },
        { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
      );
      toReveal.forEach((el) => revealer?.observe(el));
    }
  }

  let heroTop = 0;
  let pinH = 0;
  let pinDist = 0;

  function layout(): void {
    const vh = stableHeight();
    if (hero) {
      heroTop = Math.min(0, vh - hero.offsetHeight);
      hero.style.setProperty('--hero-top', `${heroTop}px`);
    }
    if (foot) root.classList.toggle('pf--foot-flow', foot.offsetHeight > vh - 24);
    if (reduce || !pin || !pinIn || !track || !view) return;
    pinH = pinIn.offsetHeight;
    const nextDist = Math.max(0, track.scrollWidth - view.clientWidth);
    if (nextDist !== pinDist) {
      pinDist = nextDist;
      pin.style.setProperty('--pin-dist', `${pinDist}px`);
    }
  }

  function update(): void {
    if (reduce) return;
    const vh = window.innerHeight;
    // Read every rect first, then write: no layout between writes.
    const y = -root.getBoundingClientRect().top;
    const wordsRect = words?.getBoundingClientRect();
    const stepRects = steps.map((el) => el.getBoundingClientRect());
    const pinRect = pin?.getBoundingClientRect();
    const footH = foot?.getBoundingClientRect().height ?? 0;
    const mainBottom = main?.getBoundingClientRect().bottom ?? 0;

    // The first screen starts to recede once it is stuck (a tall one scrolls -heroTop px first).
    put(hero, '--h', clamp01((y + heroTop) / (vh * 0.85)));
    if (wordsRect && statementWords.length) {
      const wp = clamp01((vh * 0.9 - wordsRect.top) / (vh * 0.55 + wordsRect.height * 0.6));
      const count = Math.round(wp * (statementWords.length + 1));
      if (count !== litCount) {
        litCount = count;
        statementWords.forEach((el, i) => el.classList.toggle('on', i < count));
      }
    }
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
    layout();
    onScroll();
  };

  // Arrival by anchor (/#pricing from the journal): the browser jumps before fonts load and the
  // pinned strip gets its height, which moves the sections below. Re-align until the person scrolls.
  let personMoved = false;
  const onPersonMove = (): void => {
    personMoved = true;
  };
  const personEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  const reanchor = (): void => {
    if (personMoved || window.location.hash.length < 2) return;
    let id = window.location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep the raw id */
    }
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  // Smooth scrolling (CSS) only for in-page jumps after load, never for the arrival itself.
  const onLoad = (): void => {
    layout();
    reanchor();
    document.documentElement.classList.add('pf-smooth');
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

  window.addEventListener('resize', onResize);
  for (const type of personEvents) window.addEventListener(type, onPersonMove, { passive: true });
  if (!reduce) {
    window.addEventListener('scroll', onScroll, { passive: true });
    hero?.addEventListener('pointermove', onPointerMove);
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
  observer?.observe(root);

  if (!reduce) centerLight();
  layout();
  update();
  reanchor();
  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad, { once: true });
  void document.fonts?.ready.then(() => {
    if (!reduce) centerLight();
    layout();
    update();
    reanchor();
  });

  return () => {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(lightFrame);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', onLoad);
    for (const type of personEvents) window.removeEventListener(type, onPersonMove);
    hero?.removeEventListener('pointermove', onPointerMove);
    observer?.disconnect();
    revealer?.disconnect();
    probe.remove();
    document.documentElement.classList.remove('pf-smooth');
    root.classList.remove('pf--motion', 'pf--static', 'pf--foot-flow');
  };
}
