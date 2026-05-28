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
  // Если пользователь сам выставил OS-уровень reduce-motion — стартуем выключенными.
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
