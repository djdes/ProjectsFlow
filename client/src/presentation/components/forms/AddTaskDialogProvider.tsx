import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { composeSharedTaskText } from '@/lib/sharedTaskText';
import { AddTaskDialog } from './AddTaskDialog';

type AddTaskDialogContextValue = {
  open: () => void;
  // Окно с текстом новой задачи заранее (например, присланным через «Поделиться»).
  openWith: (initialText: string) => void;
};

const AddTaskDialogCtx = createContext<AddTaskDialogContextValue | null>(null);

/**
 * Монтируется один раз на уровне приложения. Хранит единственный экземпляр диалога
 * быстрого добавления задачи. Любой компонент вызывает `open()` через `useAddTaskDialog()`.
 *
 * «Поделиться → ProjectsFlow» (share_target в manifest.webmanifest): система открывает
 * `/share?title&text&url`, маршрут переводит на `/?share=…`, а здесь окно открывается с этим
 * текстом и параметр убирается из адреса (повторное открытие страницы не плодит окна).
 */
export function AddTaskDialogProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [initialText, setInitialText] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shared = params.get('share');
    if (shared === null) return;
    params.delete('share');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
    if (shared.trim()) {
      setInitialText(shared);
      setIsOpen(true);
    }
  }, [location.search, location.pathname, location.hash, navigate]);
  return (
    <AddTaskDialogCtx.Provider
      value={{
        open: () => {
          setInitialText(null);
          setIsOpen(true);
        },
        openWith: (text) => {
          setInitialText(text);
          setIsOpen(true);
        },
      }}
    >
      {children}
      <AddTaskDialog
        open={isOpen}
        initialDescription={initialText}
        onOpenChange={(next) => {
          setIsOpen(next);
          if (!next) setInitialText(null);
        }}
      />
    </AddTaskDialogCtx.Provider>
  );
}

export function useAddTaskDialog(): AddTaskDialogContextValue {
  const c = useContext(AddTaskDialogCtx);
  if (!c) {
    throw new Error('useAddTaskDialog must be used inside <AddTaskDialogProvider>');
  }
  return c;
}

// Маршрут /share (цель «Поделиться»): собираем текст задачи и уводим на «Входящие».
export function sharedTaskSearch(search: string): string {
  const params = new URLSearchParams(search);
  const text = composeSharedTaskText({ title: params.get('title'), text: params.get('text'), url: params.get('url') });
  return text ? `?share=${encodeURIComponent(text)}` : '';
}
