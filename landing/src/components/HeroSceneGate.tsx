import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

// Тяжёлый three.js-чанк (~1 МБ) грузится ТОЛЬКО через этот dynamic import — и только
// когда гейт реально решает монтировать сцену. Сам гейт монтируется на десктопе через
// client:media="(min-width: 1024px)" в Hero.astro, поэтому на мобиле этот модуль вообще
// не скачивается. Здесь — дополнительные проверки: reduced-motion и доступность WebGL.
const HeroScene = lazy(() => import('./HeroScene'));

// Error boundary: если инициализация WebGL/three упадёт в рантайме (слабый GPU, потеря
// контекста, баг драйвера) — глушим и показываем статичный постер (CSS-фон под канвасом).
class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

// Сообщаем Hero-разметке, какой визуал показывать: 'on' — работает 3D (прячем запасной
// «кабинет»), 'off' — 3D нет (показываем интерактивное превью кабинета).
function setHeroScene(on: boolean): void {
  try {
    document.querySelector('.hero')?.setAttribute('data-scene', on ? 'on' : 'off');
  } catch {
    /* noop */
  }
}

export default function HeroSceneGate(): React.ReactElement | null {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Уже решили в этой сессии, что 3D тормозит — больше не пробуем (без мигания).
    try {
      if (sessionStorage.getItem('pf_hero_3d') === 'off') {
        setHeroScene(false);
        return;
      }
    } catch {
      /* noop */
    }
    // 1) reduced-motion — сцену не монтируем.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setHeroScene(false);
      return;
    }
    // 2) Узкие/coarse-pointer экраны — не монтируем.
    if (
      window.matchMedia('(max-width: 1023px)').matches ||
      window.matchMedia('(pointer: coarse)').matches
    ) {
      setHeroScene(false);
      return;
    }
    // 3) Нет WebGL — нет смысла грузить three.js.
    if (!webglAvailable()) {
      setHeroScene(false);
      return;
    }
    setEnabled(true);
    setHeroScene(true);
  }, []);

  // FPS-сторож: если сцена реально тормозит на этом железе — выключаем её (показываем
  // запасной «кабинет») и запоминаем на сессию, чтобы не тормозить и не мигать.
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let warmStart = 0;
    let sampleStart = 0;
    let frames = 0;
    let stopped = false;

    const tick = (t: number): void => {
      if (stopped) return;
      if (!warmStart) warmStart = t;
      // Прогрев ~1.4с (компиляция шейдеров/загрузка) — не меряем.
      if (t - warmStart < 1400) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!sampleStart) {
        sampleStart = t;
        frames = 0;
        raf = requestAnimationFrame(tick);
        return;
      }
      frames++;
      if (t - sampleStart >= 2200) {
        const fps = (frames * 1000) / (t - sampleStart);
        // Консервативный порог: выключаем 3D только если реально «слайд-шоу» (<30 fps),
        // чтобы на нормальных машинах сцена всегда оставалась.
        if (fps < 30) {
          try {
            sessionStorage.setItem('pf_hero_3d', 'off');
          } catch {
            /* noop */
          }
          setHeroScene(false);
          setEnabled(false); // размонтируем тяжёлую сцену
        }
        return; // одного замера достаточно
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <SceneErrorBoundary>
      <Suspense fallback={null}>
        <HeroScene />
      </Suspense>
    </SceneErrorBoundary>
  );
}
