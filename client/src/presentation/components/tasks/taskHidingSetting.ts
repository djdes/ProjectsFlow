import { useEffect, useState } from 'react';

// Глобальная (на весь сайт) настройка «Скрывать лишние задачи» в канбанах.
// ВЫКЛючена по умолчанию: тогда все колонки показывают ВСЕ задачи сразу (без
// «Показать ещё»/«Свернуть»). ВКЛючена — прежнее поведение (первые 4 + порции).
// Хранится в localStorage, синхронизируется между компонентами и вкладками.
const KEY = 'pf:task-hiding';
const EVENT = 'pf:task-hiding-changed';

export function getTaskHiding(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
    // Не задано: на ТАЧ-устройствах (телефон/PWA, pointer: coarse) включаем по умолчанию —
    // колонка рендерит первые 4 карточки + «Показать ещё». Иначе сотни тяжёлых карточек
    // (markdown-тело + аватары в каждой) вешают скролл на iPhone. Десктоп — показываем все.
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function setTaskHiding(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useTaskHiding(): boolean {
  const [on, setOn] = useState(getTaskHiding);
  useEffect(() => {
    const sync = (): void => setOn(getTaskHiding());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // другая вкладка
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}
