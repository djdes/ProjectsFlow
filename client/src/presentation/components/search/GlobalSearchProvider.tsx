import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { TaskSearchDialog } from './TaskSearchDialog';

type GlobalSearch = {
  readonly open: () => void;
};

const GlobalSearchCtx = createContext<GlobalSearch | null>(null);

// Глобальная палитра поиска: одно состояние open на всё приложение + хоткей Cmd/Ctrl+K.
// Диалог рендерится один раз здесь; триггеры (хоткей, кнопка в сайдбаре) зовут open().
export function GlobalSearchProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <GlobalSearchCtx.Provider value={{ open }}>
      {children}
      <TaskSearchDialog open={isOpen} onOpenChange={setIsOpen} />
    </GlobalSearchCtx.Provider>
  );
}

export function useGlobalSearch(): GlobalSearch {
  const ctx = useContext(GlobalSearchCtx);
  if (!ctx) throw new Error('useGlobalSearch must be used inside <GlobalSearchProvider>');
  return ctx;
}
