import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { MotionConfig } from 'motion/react';
import { motionEnabled } from '@/lib/motionPreference';

type MotionContextValue = {
  animations: boolean;
  setAnimations: (value: boolean) => void;
};
const MotionCtx = createContext<MotionContextValue | null>(null);

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function systemReduced(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function MotionProvider({
  children,
  storageKey = 'pf-motion',
}: {
  children: ReactNode;
  storageKey?: string;
}): React.ReactElement {
  const [preference, setPreference] = useState(() =>
    readPreference(storageKey),
  );
  const [reduced, setReduced] = useState(systemReduced);
  const animations = motionEnabled(preference, reduced);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = (): void => setReduced(query.matches);
    const stored = (event: StorageEvent): void => {
      if (event.key === storageKey || event.key === null)
        setPreference(readPreference(storageKey));
    };
    query.addEventListener('change', changed);
    window.addEventListener('storage', stored);
    return () => {
      query.removeEventListener('change', changed);
      window.removeEventListener('storage', stored);
    };
  }, [storageKey]);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('pf-no-motion', !animations);
  }, [animations]);
  const setAnimations = (value: boolean): void => {
    const next = value ? 'on' : 'off';
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Preference still works in memory. */
    }
    setPreference(next);
  };
  return (
    <MotionCtx.Provider value={{ animations, setAnimations }}>
      <MotionConfig reducedMotion={animations ? 'never' : 'always'}>
        {children}
      </MotionConfig>
    </MotionCtx.Provider>
  );
}

export function useMotion(): MotionContextValue {
  const context = useContext(MotionCtx);
  if (!context)
    throw new Error('useMotion must be used inside <MotionProvider>');
  return context;
}
