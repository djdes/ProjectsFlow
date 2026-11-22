import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { boxIn, LiquidIndicator, motionReduced, type IndicatorBox } from '@/lib/liquidIndicator';

type Options = {
  // Контейнер вкладок; индикатор — его абсолютный потомок (контейнер — position: relative).
  containerRef: RefObject<HTMLElement | null>;
  indicatorRef: RefObject<HTMLElement | null>;
  // Как найти выбранную вкладку внутри контейнера.
  activeSelector: string;
  // Смена выбранной вкладки, если её знает React. Без него индикатор следит за атрибутами
  // (watchAttributes) — так работает Radix Tabs, где выбор живёт в data-state.
  activeKey?: unknown;
  watchAttributes?: readonly string[];
  // Форма индикатора по рамке вкладки (подчёркивание вместо подложки и т.п.).
  shape?: (box: IndicatorBox) => IndicatorBox;
  // «Скольжение»: у вкладки своя подложка (например, папка, срастающаяся с панелью), а
  // индикатор виден только в полёте — от прежней вкладки к новой; новая на это время
  // помечена data-pf-glide-target, и её подложка ждёт индикатор.
  glide?: boolean;
  // Сам выбор может мешать измерению (ведёт палец) — тогда индикатор не трогаем.
  paused?: () => boolean;
  // Выбор перешёл с одной вкладки на другую (не первый показ) — например, чтобы знать, в
  // какую сторону въезжает содержимое.
  onActiveChange?: (previous: Element, next: Element) => void;
};

export function useLiquidIndicator({
  containerRef,
  indicatorRef,
  activeSelector,
  activeKey,
  watchAttributes,
  shape,
  glide = false,
  paused,
  onActiveChange,
}: Options): RefObject<LiquidIndicator | null> {
  const engineRef = useRef<LiquidIndicator | null>(null);
  const engineElRef = useRef<HTMLElement | null>(null);
  const activeElRef = useRef<Element | null>(null);
  const targetRef = useRef<Element | null>(null);
  const optionsRef = useRef({ activeSelector, shape, glide, paused, onActiveChange });
  useLayoutEffect(() => {
    optionsRef.current = { activeSelector, shape, glide, paused, onActiveChange };
  });

  const hideTimer = useRef(0);
  const settle = (): void => {
    const indicator = indicatorRef.current;
    if (!optionsRef.current.glide || !indicator) return;
    // Своя подложка вкладки проявляется (у неё короткий transition) под ещё видимым
    // индикатором, и только потом он гаснет — на месте посадки ничего не мигает.
    targetRef.current?.removeAttribute('data-pf-glide-target');
    targetRef.current = null;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!engineRef.current?.moving) indicator.style.opacity = '0';
    }, 220);
  };

  const measure = (el: Element | null): IndicatorBox | null => {
    const container = containerRef.current;
    if (!container || !el || !el.isConnected) return null;
    const box = boxIn(container, el);
    if (box.width === 0 && box.height === 0) return null;
    return optionsRef.current.shape ? optionsRef.current.shape(box) : box;
  };

  // Выбор сменился: перетечь от прежней вкладки к новой.
  const sync = (firstSync: boolean): void => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    if (optionsRef.current.paused?.()) return;
    let initial = firstSync;
    // Элемент индикатора мог смениться (раскладка перестроилась: телефон ↔ широкий экран) —
    // новый движок для нового элемента, первая постановка без движения.
    if (!engineRef.current || engineElRef.current !== indicator) {
      engineRef.current?.destroy();
      engineRef.current = new LiquidIndicator(indicator, settle);
      engineElRef.current = indicator;
      initial = true;
    }
    const engine = engineRef.current;
    const nextEl = container.querySelector(optionsRef.current.activeSelector);
    const previousEl = activeElRef.current;
    activeElRef.current = nextEl;
    if (!initial && previousEl && nextEl && previousEl !== nextEl) optionsRef.current.onActiveChange?.(previousEl, nextEl);
    const next = measure(nextEl);

    if (optionsRef.current.glide) {
      const from = previousEl && previousEl !== nextEl ? measure(previousEl) : null;
      if (initial || !from || !next || motionReduced()) {
        indicator.style.opacity = '0';
        return;
      }
      window.clearTimeout(hideTimer.current);
      targetRef.current?.removeAttribute('data-pf-glide-target');
      targetRef.current = nextEl;
      nextEl?.setAttribute('data-pf-glide-target', '');
      engine.jump(from);
      indicator.style.opacity = '1';
      engine.springTo(next);
      return;
    }

    if (!next) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.opacity = '1';
    if (initial || !engine.box) engine.jump(next);
    else if (previousEl === nextEl && !engine.moving) engine.jump(next);
    else engine.springTo(next);
  };

  // Раскладка поменялась (ширина экрана, жирный шрифт выбранной, подгрузились счётчики):
  // индикатор подстраивается к той же вкладке. В полёте — меняется только цель.
  const relayout = (): void => {
    const engine = engineRef.current;
    const indicator = indicatorRef.current;
    if (!engine || !indicator || optionsRef.current.paused?.()) return;
    if (optionsRef.current.glide) return;
    const next = measure(activeElRef.current);
    if (!next) return;
    // Ряд мог появиться только сейчас (смонтирован скрытым — в свёрнутой панели, на
    // невидимой вкладке): тогда индикатор ещё прозрачный.
    indicator.style.opacity = '1';
    if (engine.moving) engine.springTo(next);
    else engine.jump(next);
  };

  // Наблюдатели цепляются к тому контейнеру, что есть сейчас: ряд может появиться позже хука
  // (содержимое окна монтируется при открытии) и смениться при повторном открытии.
  const observed = useRef<{ el: HTMLElement; resize: ResizeObserver; mutation: MutationObserver | null } | null>(null);
  const observe = (): void => {
    const container = containerRef.current;
    if (observed.current?.el === container) return;
    observed.current?.resize.disconnect();
    observed.current?.mutation?.disconnect();
    observed.current = null;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const resize = new ResizeObserver(() => relayout());
    resize.observe(container);
    for (const child of Array.from(container.children)) resize.observe(child);
    let mutation: MutationObserver | null = null;
    if (watchAttributes?.length) {
      mutation = new MutationObserver(() => {
        const nextEl = container.querySelector(optionsRef.current.activeSelector);
        if (nextEl !== activeElRef.current) sync(false);
        else relayout();
      });
      mutation.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: [...watchAttributes] });
    }
    observed.current = { el: container, resize, mutation };
  };

  useLayoutEffect(() => {
    observe();
    sync(engineRef.current === null);
    // sync/observe read everything through refs; they re-run on the explicit key only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  useEffect(() => {
    observe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);
      engineRef.current?.destroy();
      engineRef.current = null;
      targetRef.current?.removeAttribute('data-pf-glide-target');
      observed.current?.resize.disconnect();
      observed.current?.mutation?.disconnect();
      observed.current = null;
    },
    [],
  );

  return engineRef;
}
