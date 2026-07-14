import { createContext, useContext } from 'react';

// Ширина открытого справа окна активности, px. Основной <main> не меняет геометрию:
// ширину читают только синяя плашка публикации и строка режимов отображения. 0 — закрыто.
const RightPanelContext = createContext<(width: number) => void>(() => undefined);

export const RightPanelProvider = RightPanelContext.Provider;

export function useSetRightPanelWidth(): (width: number) => void {
  return useContext(RightPanelContext);
}

// Текущая ширина правой панели для точечных layout-реакций разрешённых элементов.
const RightPanelWidthContext = createContext<number>(0);

export const RightPanelWidthProvider = RightPanelWidthContext.Provider;

export function useRightPanelWidth(): number {
  return useContext(RightPanelWidthContext);
}
