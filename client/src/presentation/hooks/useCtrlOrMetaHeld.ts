import { useSyncExternalStore } from 'react';

// Глобальное состояние «зажат ли Ctrl (или ⌘ на macOS)». Один набор слушателей на всё
// приложение (module-singleton), компоненты подписываются дёшево через useSyncExternalStore —
// ре-рендерятся только сами подписчики, а не их родители. Используется, например, для
// аффорданса «Ctrl+клик = выполнить» на карточках задач.
let held = false;
const listeners = new Set<() => void>();
let attached = false;

function emit(): void {
  for (const l of listeners) l();
}

function setHeld(next: boolean): void {
  if (next === held) return;
  held = next;
  emit();
}

// На keydown/keyup флаги ctrlKey/metaKey уже отражают актуальное состояние модификатора
// (в т.ч. keyup самого Ctrl приходит с ctrlKey=false) — одного обработчика хватает для обоих.
function onKey(e: KeyboardEvent): void {
  setHeld(e.ctrlKey || e.metaKey);
}

// Уводя фокус/скрывая вкладку, keyup можно не получить — сбрасываем, чтобы флаг не «залип».
function reset(): void {
  setHeld(false);
}

function ensureAttached(): void {
  if (attached) return;
  attached = true;
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
}

function subscribe(cb: () => void): () => void {
  ensureAttached();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useCtrlOrMetaHeld(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => held,
    () => false,
  );
}
