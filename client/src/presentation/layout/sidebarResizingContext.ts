import { createContext, useContext } from 'react';

// Тянут ли сейчас ручку ширины левой панели (desktop). Пока тянут — канбан-карточки
// отключают layout-анимацию (motion), иначе они «плывут» пружиной за колонками при каждом
// шаге ресайза и «висят в воздухе» до отпускания ручки.
export const SidebarResizingContext = createContext(false);

export function useSidebarResizing(): boolean {
  return useContext(SidebarResizingContext);
}
