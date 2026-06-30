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

export default function HeroSceneGate(): React.ReactElement | null {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // 1) Уважаем prefers-reduced-motion — сцену не монтируем (chunk не грузим).
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // 2) Подстраховка к client:media — не монтируем на узких/coarse-pointer экранах.
    const narrow = window.matchMedia('(max-width: 1023px)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (narrow || coarse) return;
    // 3) Нет WebGL — нет смысла грузить three.js.
    if (!webglAvailable()) return;
    setEnabled(true);
  }, []);

  if (!enabled) return null;

  return (
    <SceneErrorBoundary>
      <Suspense fallback={null}>
        <HeroScene />
      </Suspense>
    </SceneErrorBoundary>
  );
}
