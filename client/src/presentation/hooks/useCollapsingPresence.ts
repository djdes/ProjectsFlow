import { useEffect, useRef, useState } from 'react';

// Держит блок «смонтированным» ещё `ms` после того, как `active` переключился true → false —
// чтобы вызывающий успел проиграть CSS-коллапс (ширина/высота → 0) ПЕРЕД тем, как элемент
// реально уйдёт из списка/DOM, а не исчез скачком. Используется колонкой «На утверждении»
// (KanbanBoard) — она то появляется, то пропадает вместе с grouped.pending_approval.length.
// Аналог useFlashExitPhase, но триггер — внешнее присутствие (есть ли ещё элементы), а не
// явное действие пользователя.
export type UseCollapsingPresenceResult = {
  // Рендерить ли блок вообще (true и пока active, и во время коллапса после).
  mounted: boolean;
  // true только во время «уходящего» окна — вызывающий применяет схлопывающие стили.
  collapsing: boolean;
};

export function useCollapsingPresence(active: boolean, ms: number): UseCollapsingPresenceResult {
  const [mounted, setMounted] = useState(active);
  const [collapsing, setCollapsing] = useState(false);
  // Был ли active когда-либо true — если нет, коллапсировать нечего.
  const wasActiveRef = useRef(active);

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      setMounted(true);
      setCollapsing(false);
      return undefined;
    }
    if (!wasActiveRef.current) {
      setMounted(false);
      return undefined;
    }
    // active только что стал false — держим смонтированным на время коллапса.
    setCollapsing(true);
    // ms=0 (анимации выключены пользователем/prefers-reduced-motion) — убираем на
    // следующем тике без видимой задержки, но не синхронно (чтобы не рвать текущий рендер).
    const t = window.setTimeout(() => {
      wasActiveRef.current = false;
      setMounted(false);
      setCollapsing(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);

  return { mounted, collapsing };
}
