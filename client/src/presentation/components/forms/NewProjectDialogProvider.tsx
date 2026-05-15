import { createContext, useContext, useState, type ReactNode } from 'react';
import { NewProjectDialog } from './NewProjectDialog';

type NewProjectDialogContextValue = {
  open: () => void;
};

const NewProjectDialogCtx = createContext<NewProjectDialogContextValue | null>(null);

/**
 * Монтируется один раз на уровне приложения. Хранит единственный экземпляр
 * диалога создания проекта. Любой компонент в дереве может вызвать `open()`
 * через `useNewProjectDialog()`.
 */
export function NewProjectDialogProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <NewProjectDialogCtx.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <NewProjectDialog open={isOpen} onOpenChange={setIsOpen} />
    </NewProjectDialogCtx.Provider>
  );
}

export function useNewProjectDialog(): NewProjectDialogContextValue {
  const c = useContext(NewProjectDialogCtx);
  if (!c) {
    throw new Error(
      'useNewProjectDialog must be used inside <NewProjectDialogProvider>',
    );
  }
  return c;
}
