import { createContext, useContext } from 'react';

// Свёрнута ли левая панель (desktop). Нужен крошкам, чтобы уступить место плавающему
// бургеру в верхнем-левом углу (иначе он наезжает на «Проекты · …»).
export const SidebarCollapsedContext = createContext(false);

export function useSidebarCollapsed(): boolean {
  return useContext(SidebarCollapsedContext);
}
