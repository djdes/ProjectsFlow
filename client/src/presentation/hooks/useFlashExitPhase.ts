import { useEffect, useRef, useState } from 'react';

// Общий движок анимации «мигнул зелёным → сжался → закоммитил в сеть»: 200мс вспышка,
// 300мс коллапс, потом сетевая мутация. Вынесен из AcceptedCard.completePhase
// (client/src/presentation/components/tasks/AssignedToMeBlock.tsx) — переиспользуется
// приёмкой с полки «На утверждении» (ApprovalItemCard, тот же файл), чтобы третьей копии
// уже не заводить.
export type FlashExitPhase = 'idle' | 'flash' | 'exit';

export const FLASH_MS = 200;
export const EXIT_MS = 300;

export type UseFlashExitPhaseResult = {
  phase: FlashExitPhase;
  // idle → flash. Повторные вызовы, пока фаза уже не idle, — no-op (уже идёт).
  start: () => void;
};

// `key` — единственная СТАБИЛЬНАЯ (примитивная, не меняющаяся за время анимации) величина
// в зависимостях эффекта, который переключает фазы и в конце коммитит `onCommit`. Обычно
// это `item.id`. `onCommit`/`onError` тянутся через ref, обновляемый на КАЖДОМ рендере без
// собственного списка зависимостей — так родитель может отдавать новую ссылку на них
// (например, потому что где-то параллельно прилетел refresh() и пересобрал массив задач,
// а с ним и объект item) не сбрасывая уже тикающий таймер. Это принципиально: если бы в
// зависимостях фазового эффекта был весь `item` (а не только `key`), КАЖДЫЙ посторонний
// refresh() посреди анимации отменял бы clearTimeout и взводил её заново — карточка
// зависала бы между «визуально исчезла» и «реально закоммичена на сервере».
export function useFlashExitPhase(
  key: string,
  onCommit: () => Promise<void>,
  onError: (err: unknown) => void,
): UseFlashExitPhaseResult {
  const [phase, setPhase] = useState<FlashExitPhase>('idle');

  const onCommitRef = useRef(onCommit);
  const onErrorRef = useRef(onError);
  // Без deps — обновляет refs на каждом рендере, но НЕ трогает фазовый эффект ниже.
  useEffect(() => {
    onCommitRef.current = onCommit;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (phase === 'flash') {
      const t = setTimeout(() => setPhase('exit'), FLASH_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'exit') {
      const t = setTimeout(() => {
        void (async () => {
          try {
            await onCommitRef.current();
          } catch (err) {
            setPhase('idle');
            onErrorRef.current(err);
          }
        })();
      }, EXIT_MS);
      return () => clearTimeout(t);
    }
    return undefined;
    // key — единственная реальная внешняя зависимость помимо phase; onCommit/onError
    // тут не читаются напрямую (только через ref, см. комментарий над функцией), поэтому
    // ESLint's exhaustive-deps корректно не требует их в массиве.
  }, [phase, key]);

  const start = (): void => setPhase((p) => (p === 'idle' ? 'flash' : p));

  return { phase, start };
}
