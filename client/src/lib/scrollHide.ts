// Floating «+» on a phone: it rides over the right edge of task cards, so it slides away while
// the list scrolls down (reading) and returns on the first scroll up (looking for actions).
// Small jitters do not toggle it; near the top it is always shown.
export const SCROLL_HIDE_TOP_PX = 48;
export const SCROLL_HIDE_DELTA_PX = 8;

export function nextScrollHidden(hidden: boolean, previousTop: number, top: number): boolean {
  if (top <= SCROLL_HIDE_TOP_PX) return false;
  const delta = top - previousTop;
  if (delta > SCROLL_HIDE_DELTA_PX) return true;
  if (delta < -SCROLL_HIDE_DELTA_PX) return false;
  return hidden;
}
