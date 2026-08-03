import { createContext, useContext, useMemo, useState } from 'react';

// Сотрудник, чьи «Входящие» сейчас открыты руководителем (клик по кубику в блоке
// ответственных). null = смотрим свои.
export type FocusedInboxMember = {
  readonly userId: string;
  readonly displayName: string;
};

type FocusedInbox = {
  readonly member: FocusedInboxMember | null;
  readonly setMember: (member: FocusedInboxMember | null) => void;
};

const FocusedInboxContext = createContext<FocusedInbox | null>(null);

/**
 * Состояние «открыта доска сотрудника» живёт выше страницы «Входящие», потому что его
 * читают ДВА разных места: сам блок ответственных (он рисует доску) и диалог быстрого
 * добавления задачи (он подставляет этого сотрудника ответственным). Держать флаг внутри
 * блока было нельзя — диалог монтируется в AppShell, рядом с рейлом, и до локального
 * стейта блока не дотягивается.
 */
export function FocusedInboxProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [member, setMember] = useState<FocusedInboxMember | null>(null);
  const value = useMemo(() => ({ member, setMember }), [member]);
  return <FocusedInboxContext.Provider value={value}>{children}</FocusedInboxContext.Provider>;
}

// Вне провайдера — «смотрим свои входящие»: компонент может рендериться в изоляции
// (публичная доска, предпросмотр), и там чужих досок не бывает.
const NOOP: FocusedInbox = { member: null, setMember: () => {} };

export function useFocusedInbox(): FocusedInbox {
  return useContext(FocusedInboxContext) ?? NOOP;
}
