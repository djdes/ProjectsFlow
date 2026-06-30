import { createContext, useContext, useState, type ReactNode } from 'react';
import { UpgradeDialog } from './UpgradeDialog';

type UpgradeDialogContextValue = {
  open: () => void;
};

const UpgradeDialogCtx = createContext<UpgradeDialogContextValue | null>(null);

// Один экземпляр таблицы тарифов на приложение; любой компонент зовёт open() через хук.
export function UpgradeDialogProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <UpgradeDialogCtx.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <UpgradeDialog open={isOpen} onOpenChange={setIsOpen} />
    </UpgradeDialogCtx.Provider>
  );
}

export function useUpgradeDialog(): UpgradeDialogContextValue {
  const c = useContext(UpgradeDialogCtx);
  if (!c) throw new Error('useUpgradeDialog must be used inside <UpgradeDialogProvider>');
  return c;
}
