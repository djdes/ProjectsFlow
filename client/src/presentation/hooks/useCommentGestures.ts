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
  onTouchEnd: () => void;
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
  const dxRef = useRef(0);
  const [offset, setOffset] = useState(0);

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const reset = (): void => {
    clearTimer();
    start.current = null;
    axis.current = 'undecided';
    dxRef.current = 0;
    setOffset(0);
  };

  const handlers: Handlers = {
    onTouchStart(event) {
      if (disabled || event.touches.length !== 1) return;
      const target = event.target as Element;
      if (target.closest('button, a, input, textarea, img, [contenteditable="true"], [role="menu"]')) return;
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
      axis.current = 'undecided';
      if (onLongPress) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          if (axis.current !== 'undecided') return;
          haptic('tap');
          start.current = null;
          onLongPress();
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
        if (axis.current !== 'undecided') clearTimer();
        if (axis.current === 'horizontal' && !onReply) axis.current = 'vertical';
      }
      if (axis.current !== 'horizontal') return;
      const before = dxRef.current;
      dxRef.current = dx;
      if (swipeCommitsReply(dx) !== swipeCommitsReply(before)) haptic('tap');
      setOffset(swipeOffset(dx));
    },
    onTouchEnd() {
      const commit = axis.current === 'horizontal' && swipeCommitsReply(dxRef.current);
      reset();
      if (commit) onReply?.();
    },
    onTouchCancel: reset,
  };

  // offset equals the finger travel below SWIPE_MAX_PX, so it tells whether release replies.
  return { handlers, offset, armed: swipeCommitsReply(offset) };
}
