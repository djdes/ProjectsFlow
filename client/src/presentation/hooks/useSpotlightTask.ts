import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

// Просьба подсветить задачу, когда пользователь УЖЕ на «Входящих»: тогда навигация не
// нужна и была бы вредна — она сбрасывает позицию скролла и состояние страницы.
export const SPOTLIGHT_TASK_EVENT = 'pf:spotlight-task';

// Сколько ждём появления карточки в DOM. Задачу могли назначить секунду назад, и список
// ещё не успел её получить: сначала просим обновиться, потом ждём результат.
const MAX_WAIT_MS = 5000;
const POLL_MS = 120;
const FLASH_MS = 2600;

/**
 * Подсветка «задача прилетела»: скроллим к карточке и даём горячую оранжевую вспышку,
 * которая остывает. Если задача непрочитана, под ней остаётся обычная синяя подсветка —
 * получается переход «горячее → остыло → синее», без отдельной логики на стыке.
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

  // Ожидание карточки живёт в ref, а НЕ в очистке эффекта. Из-за этого была неочевидная
  // поломка: убирая `?task=` из адреса, эффект перезапускался, его cleanup останавливал
  // поиск — и подсветка не срабатывала вообще, потому что карточка к первому тику ещё
  // не отрисована. Теперь остановить поиск может только новый запуск или размонтирование.
  const stopRef = useRef<(() => void) | null>(null);

  const spotlight = useCallback((id: string): void => {
    stopRef.current?.();
    let stopped = false;
    stopRef.current = () => {
      stopped = true;
    };

    // Задача могла появиться только что — просим список обновиться и параллельно ждём
    // карточку в DOM. Ответа refresh'а не ждём: данные могут приехать и realtime-событием.
    void refreshRef.current?.();
    const started = Date.now();

    const tick = (): void => {
      if (stopped) return;
      const el = document.querySelector<HTMLElement>(`[data-pf-task-id="${CSS.escape(id)}"]`);
      if (!el) {
        if (Date.now() - started < MAX_WAIT_MS) window.setTimeout(tick, POLL_MS);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      el.classList.add('pf-arrive');
      window.setTimeout(() => el.classList.remove('pf-arrive'), FLASH_MS);
    };

    tick();
  }, []);

  // Вход 1: ссылка с ?task=. Параметр убираем сразу — иначе обновление страницы или
  // возврат по истории включали бы эффект заново, а он разовый по смыслу.
  useEffect(() => {
    if (!taskId || !ready) return;
    spotlight(taskId);
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    setSearchParams(next, { replace: true });
    // searchParams/setSearchParams меняются на каждый рендер роутера — держим зависимость
    // на id и готовности, иначе эффект перезапускался бы и подсвечивал повторно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, ready, spotlight]);

  // Вход 2: мы уже на странице — подсвечиваем без навигации.
  useEffect(() => {
    const onSpotlight = (e: Event): void => {
      const id = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (id) spotlight(id);
    };
    window.addEventListener(SPOTLIGHT_TASK_EVENT, onSpotlight);
    return () => window.removeEventListener(SPOTLIGHT_TASK_EVENT, onSpotlight);
  }, [spotlight]);

  // Размонтирование страницы — единственная причина бросить незавершённое ожидание.
  useEffect(() => () => stopRef.current?.(), []);
}
