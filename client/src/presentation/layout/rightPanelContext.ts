import { createContext, useContext } from 'react';

// Ширина открытого справа окна-оверлея (drawer задачи / окно изменений·аналитики), px.
// Главный <main> сужается на эту ширину → его вертикальный скролл сдвигается влево, к самой
// линии ресайза окна (Notion-style): скролл главного окна не прячется под оверлеем. 0 — закрыто.
// Окна публикуют свою ширину через useSetRightPanelWidth (только на десктопе, где они ресайзятся).
const RightPanelContext = createContext<(width: number) => void>(() => undefined);

export const RightPanelProvider = RightPanelContext.Provider;

export function useSetRightPanelWidth(): (width: number) => void {
  return useContext(RightPanelContext);
}
