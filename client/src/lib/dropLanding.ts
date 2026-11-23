// «Отпустил — встало на место пружиной оттуда, где отпустил». Перетаскивание и так идёт за
// пальцем напрямую; после броска карточка задачи монтируется уже в новой колонке и
// прилетает в свой слот из точки, где её отпустили (а не возникает там рывком).
//
// Развязано через память бросков: обработчик броска запоминает точку для задачи, карточка
// при монтировании в новом месте забирает её. Так не важно, когда именно доска применит
// перенос (сразу, после таймера или после ответа сервера) — лишь бы за полторы секунды.
import { motionReduced } from '@/lib/liquidIndicator';

type Point = { x: number; y: number };
const drops = new Map<string, Point & { at: number }>();
const TTL_MS = 1500;

/** Where the pointer was released: the activating event's position plus the drag delta. */
export function dropPoint(activator: Event | null | undefined, delta: Point): Point | null {
  if (!activator) return null;
  let x: number | undefined;
  let y: number | undefined;
  if (typeof TouchEvent !== 'undefined' && activator instanceof TouchEvent) {
    const touch = activator.touches[0] ?? activator.changedTouches[0];
    x = touch?.clientX;
    y = touch?.clientY;
  } else if ('clientX' in activator) {
    x = (activator as MouseEvent).clientX;
    y = (activator as MouseEvent).clientY;
  }
  if (x == null || y == null) return null;
  return { x: x + delta.x, y: y + delta.y };
}

export function rememberDrop(taskId: string, point: Point | null): void {
  if (point) drops.set(taskId, { ...point, at: performance.now() });
}

/** Called by a card when it mounts: if it was just dropped, it springs in from the drop point. */
export function landFromDrop(taskId: string, el: HTMLElement | null): void {
  const drop = drops.get(taskId);
  if (!drop || !el) return;
  drops.delete(taskId);
  if (performance.now() - drop.at > TTL_MS || motionReduced() || typeof el.animate !== 'function') return;
  const r = el.getBoundingClientRect();
  const dx = drop.x - (r.left + r.width / 2);
  const dy = drop.y - (r.top + r.height / 2);
  if (Math.hypot(dx, dy) < 8) return;
  el.animate(
    [
      { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.55)`, opacity: 0.55 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  );
}
