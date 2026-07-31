import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

// Просьба подсветить задачу, когда пользователь УЖЕ на «Входящих»: тогда навигация не
// нужна и была бы вредна — она сбрасывает позицию скролла и состояние страницы.
export const SPOTLIGHT_TASK_EVENT = 'pf:spotlight-task';

// Сколько ждём появления карточки в DOM. Задачу могли назначить секунду назад, и список
// ещё не успел её получить: сначала просим обновиться, потом ждём результат.
const MAX_WAIT_MS = 5000;
const POLL_MS = 120;
const FLASH_MS = 1900;

/**
 * Подсветка задачи «прожектором»: скроллим к карточке и проигрываем разовый эффект.
 *
 * Два входа, одно поведение:
 *  - `?task=<id>` в адресе — пришли на страницу по ссылке из плашки-уведомления;
 *  - событие SPOTLIGHT_TASK_EVENT — уже были на странице, переход не нужен.
 *
 * `ready` — список уже отрисован; без него ищем карточку в пустом DOM и сдаёмся раньше,
 * чем приедут данные. `refresh` — перечитать список: задача может быть новой и её ещё
 * нет на экране, тогда без обновления подсвечивать было бы нечего.
 */
export function useSpotlightTask(ready: boolean, refresh?: () => unknown): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = searchParams.get('task');

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const spotlight = useCallback((id: string): (() => void) => {
    let stop = false;
    // Задача могла появиться только что — просим список обновиться и параллельно ждём
    // карточку в DOM. Ждать ответ refresh'а незачем: поллинг всё равно нужен на случай,
    // когда данные приезжают realtime-событием.
    void refreshRef.current?.();
    const started = Date.now();

    const tick = (): void => {
      if (stop) return;
      const el = document.querySelector<HTMLElement>(`[data-pf-task-id="${CSS.escape(id)}"]`);
      if (!el) {
        if (Date.now() - started < MAX_WAIT_MS) window.setTimeout(tick, POLL_MS);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      el.classList.add('pf-spotlight');
      window.setTimeout(() => el.classList.remove('pf-spotlight'), FLASH_MS);
    };

    tick();
    return () => {
      stop = true;
    };
  }, []);

  // Вход 1: ссылка с ?task=. Параметр убираем сразу — иначе обновление страницы или
  // возврат по истории включали бы эффект заново, а он разовый по смыслу.
  useEffect(() => {
    if (!taskId || !ready) return;
    const cancel = spotlight(taskId);
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    setSearchParams(next, { replace: true });
    return cancel;
    // searchParams/setSearchParams меняются на каждый рендер роутера — держим зависимость
    // на id и готовности, иначе эффект перезапускался бы и подсвечивал повторно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, ready, spotlight]);

  // Вход 2: мы уже на странице — подсвечиваем без навигации.
  useEffect(() => {
    let cancel: (() => void) | undefined;
    const onSpotlight = (e: Event): void => {
      const id = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (!id) return;
      cancel?.();
      cancel = spotlight(id);
    };
    window.addEventListener(SPOTLIGHT_TASK_EVENT, onSpotlight);
    return () => {
      cancel?.();
      window.removeEventListener(SPOTLIGHT_TASK_EVENT, onSpotlight);
    };
  }, [spotlight]);
}
