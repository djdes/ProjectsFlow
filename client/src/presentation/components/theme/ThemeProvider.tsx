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

/** Browser chrome colour per theme — equals --background (globals.css). */
const THEME_COLOR = { light: '#ffffff', dark: '#16171b' } as const;

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

  // Status bar / browser chrome follows the app theme, not only the system one: with
  // «dark» chosen on a light phone the bar must not stay white. Same hex as --background
  // and the boot script in index.html.
  useEffect(() => {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = THEME_COLOR[resolved];
      meta.removeAttribute('media');
    }
  }, [resolved]);

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
