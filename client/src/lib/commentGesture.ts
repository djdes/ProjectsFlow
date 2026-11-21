// Touch gestures on a comment (phone): swipe right to reply, long press for the actions menu.
// Pure decisions only — the hook (useCommentGestures) owns timers and DOM.

/** Finger travel that still counts as «holding still» for a long press. */
export const LONG_PRESS_TOLERANCE_PX = 8;
/** How long a finger must rest on a comment before its menu opens. */
export const LONG_PRESS_MS = 450;
/** Horizontal travel that commits a reply on release. */
export const SWIPE_REPLY_PX = 56;
/** The row follows the finger up to this distance, then stops (rubber band). */
export const SWIPE_MAX_PX = 72;

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';

/** Locks the gesture to one axis once the finger has clearly moved; vertical means «scroll». */
export function lockSwipeAxis(dx: number, dy: number): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < LONG_PRESS_TOLERANCE_PX && ay < LONG_PRESS_TOLERANCE_PX) return 'undecided';
  // Only rightward swipes reply; a leftward or steep move is left to the page scroller.
  return dx > 0 && ax > ay * 1.3 ? 'horizontal' : 'vertical';
}

/** Visual offset of the row for a horizontal drag of dx pixels. */
export function swipeOffset(dx: number): number {
  if (dx <= 0) return 0;
  return dx <= SWIPE_MAX_PX ? dx : SWIPE_MAX_PX + (dx - SWIPE_MAX_PX) * 0.15;
}

/** Whether a horizontal drag of dx pixels replies when the finger lifts. */
export function swipeCommitsReply(dx: number): boolean {
  return dx >= SWIPE_REPLY_PX;
}
