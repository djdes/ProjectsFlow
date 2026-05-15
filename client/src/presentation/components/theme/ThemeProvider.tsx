import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolved: 'light' | 'dark';
};

const ThemeCtx = createContext<ThemeContextValue | null>(null);

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'pf-theme',
}: ThemeProviderProps): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : defaultTheme;
  });

  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(theme));

  useEffect(() => {
    const next = resolveTheme(theme);
    setResolved(next);
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(next);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => {
      const next: 'light' | 'dark' = mq.matches ? 'dark' : 'light';
      setResolved(next);
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(next);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme): void => {
    localStorage.setItem(storageKey, t);
    setThemeState(t);
  };

  return <ThemeCtx.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeContextValue {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error('useTheme must be used inside <ThemeProvider>');
  return c;
}
