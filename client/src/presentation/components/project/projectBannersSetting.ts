import { useEffect, useState } from 'react';

// Глобальная (на весь сайт) настройка «Скрыть плашки» над доской проекта:
// онбординг GitHub («Подключите код проекта» / «Теперь запустите проект») и синяя
// «Результат проекта опубликован». Выключена по умолчанию — плашки видны.
//
// Хранится в localStorage (не на сервере): это чисто визуальное предпочтение
// конкретного браузера, ему не нужен round-trip и он не должен ждать сети.
// Синхронизируется между компонентами и вкладками, как pf:task-hiding.
const KEY = 'pf:project-banners-hidden';
const EVENT = 'pf:project-banners-hidden-changed';

export function getProjectBannersHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setProjectBannersHidden(hidden: boolean): void {
  try {
    localStorage.setItem(KEY, hidden ? '1' : '0');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useProjectBannersHidden(): boolean {
  const [hidden, setHidden] = useState(getProjectBannersHidden);
  useEffect(() => {
    const sync = (): void => setHidden(getProjectBannersHidden());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // другая вкладка
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return hidden;
}
