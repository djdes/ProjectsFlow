import { createContext, useContext, useState, type ReactNode } from 'react';
import { AddTaskDialog } from './AddTaskDialog';

type AddTaskDialogContextValue = {
  open: () => void;
};

const AddTaskDialogCtx = createContext<AddTaskDialogContextValue | null>(null);

/**
 * Монтируется один раз на уровне приложения. Хранит единственный экземпляр диалога
 * быстрого добавления задачи. Любой компонент вызывает `open()` через `useAddTaskDialog()`.
 */
export function AddTaskDialogProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <AddTaskDialogCtx.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <AddTaskDialog open={isOpen} onOpenChange={setIsOpen} />
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
