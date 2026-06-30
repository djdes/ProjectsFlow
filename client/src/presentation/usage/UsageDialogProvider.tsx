import { createContext, useContext, useState, type ReactNode } from 'react';
import { UsageDialog } from './UsageDialog';

type UsageDialogContextValue = {
  open: () => void;
};

const UsageDialogCtx = createContext<UsageDialogContextValue | null>(null);

// Один экземпляр окна «Использование» на приложение; открывается из аккаунт-меню/баннера/профиля.
export function UsageDialogProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <UsageDialogCtx.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <UsageDialog open={isOpen} onOpenChange={setIsOpen} />
    </UsageDialogCtx.Provider>
  );
}

export function useUsageDialog(): UsageDialogContextValue {
  const c = useContext(UsageDialogCtx);
  if (!c) throw new Error('useUsageDialog must be used inside <UsageDialogProvider>');
  return c;
}
