import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { haptic } from '@/lib/haptics';
import {
  LONG_PRESS_MS,
  lockSwipeAxis,
  swipeCommitsReply,
  swipeOffset,
  type SwipeAxis,
} from '@/lib/commentGesture';

type Handlers = {
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
};

/**
 * Phone gestures for one comment: swipe right → onReply, long press → onLongPress.
 * Returns touch handlers for the row and the current swipe offset (px) for its transform.
 * Taps on buttons, links, images and the editor are left alone.
 */
export function useCommentGestures({
  onReply,
  onLongPress,
  disabled,
}: {
  onReply?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
}): { handlers: Handlers; offset: number; armed: boolean } {
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<SwipeAxis>('undecided');
  const timer = useRef<number | null>(null);
  // The press is long enough: the menu opens when the finger lifts, not under it — a menu
  // opened mid-press would take the release as a tap on whatever item lies under the finger.
  const pressArmed = useRef(false);
  const dxRef = useRef(0);
  const [offset, setOffset] = useState(0);

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const reset = (): void => {
    clearTimer();
    pressArmed.current = false;
    start.current = null;
    axis.current = 'undecided';
    dxRef.current = 0;
    setOffset(0);
  };

  const handlers: Handlers = {
    onTouchStart(event) {
      if (disabled || event.touches.length !== 1) return;
      const target = event.target as Element;
      // Typing and menus keep their own touches entirely.
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
      // A swipe may start on a button or link inside the comment (browsers snap a touch to a
      // nearby control), but a long press there belongs to the control itself.
      const onControl = target.closest('button, a, img') !== null;
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
      axis.current = 'undecided';
      if (onLongPress && !onControl) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          if (axis.current !== 'undecided') return;
          haptic('tap');
          pressArmed.current = true;
        }, LONG_PRESS_MS);
      }
    },
    onTouchMove(event) {
      if (!start.current) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.current.x;
      const dy = touch.clientY - start.current.y;
      if (axis.current === 'undecided') {
        axis.current = lockSwipeAxis(dx, dy);
        if (axis.current !== 'undecided') {
          clearTimer();
          pressArmed.current = false;
        }
        if (axis.current === 'horizontal' && !onReply) axis.current = 'vertical';
      }
      if (axis.current !== 'horizontal') return;
      const before = dxRef.current;
      dxRef.current = dx;
      if (swipeCommitsReply(dx) !== swipeCommitsReply(before)) haptic('tap');
      setOffset(swipeOffset(dx));
    },
    onTouchEnd(event) {
      const commit = axis.current === 'horizontal' && swipeCommitsReply(dxRef.current);
      const longPress = pressArmed.current;
      reset();
      if (longPress) {
        // No synthetic click after the press: it would land on the text or the opened menu.
        if (event.cancelable) event.preventDefault();
        onLongPress?.();
      }
      if (commit) onReply?.();
    },
    onTouchCancel: reset,
  };

  // offset equals the finger travel below SWIPE_MAX_PX, so it tells whether release replies.
  return { handlers, offset, armed: swipeCommitsReply(offset) };
}
