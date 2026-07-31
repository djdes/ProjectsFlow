import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

// Сколько ждём появления карточки в DOM. Список приезжает с сервера, поэтому к моменту
// перехода по ссылке нужной карточки может ещё не быть.
const MAX_WAIT_MS = 4000;
const POLL_MS = 120;
const FLASH_MS = 1900;

/**
 * Подсветка задачи, на которую пришли по ссылке `?task=<id>` (плашка «вам назначили
 * задачу»). Скроллит к карточке и проигрывает «прожектор».
 *
 * Параметр из адреса убираем сразу после срабатывания: иначе повторный рендер или
 * обновление страницы включали бы эффект заново, а он разовый по смыслу.
 *
 * `ready` — признак, что список уже отрисован. Без него хук ищет карточку в пустом
 * DOM и сдаётся раньше, чем приедут данные.
 */
export function useSpotlightTask(ready: boolean): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = searchParams.get('task');

  useEffect(() => {
    if (!taskId || !ready) return;
    let stop = false;
    const started = Date.now();

    const tryFlash = (): void => {
      if (stop) return;
      const el = document.querySelector<HTMLElement>(`[data-pf-task-id="${CSS.escape(taskId)}"]`);
      if (!el) {
        if (Date.now() - started < MAX_WAIT_MS) window.setTimeout(tryFlash, POLL_MS);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      el.classList.add('pf-spotlight');
      window.setTimeout(() => el.classList.remove('pf-spotlight'), FLASH_MS);

      // Чистим адрес, сохраняя остальные параметры.
      const next = new URLSearchParams(searchParams);
      next.delete('task');
      setSearchParams(next, { replace: true });
    };

    tryFlash();
    return () => {
      stop = true;
    };
    // searchParams/setSearchParams меняются на каждый рендер роутера — держим зависимость
    // на id и готовности, иначе эффект перезапускался бы и подсвечивал повторно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, ready]);
}
