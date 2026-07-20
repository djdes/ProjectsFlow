import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type MotionContextValue = {
  animations: boolean;
  setAnimations: (value: boolean) => void;
};

const MotionCtx = createContext<MotionContextValue | null>(null);

const CLASS_NAME = 'pf-no-motion';

function readInitial(storageKey: string): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
  } catch {
    /* localStorage недоступен */
  }
  try {
    // OS-уровень reduce-motion → стартуем выключенными.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    // Тач-устройства (телефон/планшет/PWA) по умолчанию БЕЗ анимаций: framer-motion
    // (layout/spring) и CSS-переходы на мобиле — главный источник лагов и «глюков» при
    // скролле. Пользователь может включить обратно тумблером в профиле. Десктоп (mouse) —
    // с анимациями как раньше.
    if (window.matchMedia('(pointer: coarse)').matches) return false;
    return true;
  } catch {
    return true;
  }
}

type MotionProviderProps = {
  children: ReactNode;
  storageKey?: string;
};

export function MotionProvider({
  children,
  storageKey = 'pf-motion',
}: MotionProviderProps): React.ReactElement {
  const [animations, setAnimationsState] = useState<boolean>(() => readInitial(storageKey));

  useEffect(() => {
    const root = document.documentElement;
    if (animations) {
      root.classList.remove(CLASS_NAME);
    } else {
      root.classList.add(CLASS_NAME);
    }
  }, [animations]);

  const setAnimations = (value: boolean): void => {
    try {
      localStorage.setItem(storageKey, value ? 'on' : 'off');
    } catch {
      /* localStorage недоступен — состояние всё равно применится в DOM */
    }
    setAnimationsState(value);
  };

  return <MotionCtx.Provider value={{ animations, setAnimations }}>{children}</MotionCtx.Provider>;
}

export function useMotion(): MotionContextValue {
  const c = useContext(MotionCtx);
  if (!c) throw new Error('useMotion must be used inside <MotionProvider>');
  return c;
}
