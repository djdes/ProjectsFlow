import * as React from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { FormatMenu } from './FormatMenu';

export interface FloatingAnchor { x: number; top: number; bottom: number }

// The overlay has a stable origin and stays inside the dialog's focus scope.
export function FloatingFormatMenu({ editor, anchor, onClose, getRange, ownerId }: {
  editor: Editor;
  anchor: FloatingAnchor | null;
  onClose: () => void;
  getRange?: () => { from: number; to: number } | null;
  ownerId: string;
}): React.ReactElement | null {
  const originRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const container = editor.view.dom.closest<HTMLElement>('[role="dialog"]') ?? document.body;

  React.useLayoutEffect(() => {
    if (!anchor) return;
    let frame = 0;
    const place = (): void => {
      const origin = originRef.current;
      const menu = menuRef.current;
      if (!origin || !menu) return;
      const viewport = window.visualViewport;
      const bounds = container === document.body
        ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
        : container.getBoundingClientRect();
      const left = Math.max(bounds.left, viewport?.offsetLeft ?? 0) + 8;
      const top = Math.max(bounds.top, viewport?.offsetTop ?? 0) + 8;
      const right = Math.min(bounds.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)) - 8;
      const bottom = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 8;
      menu.style.maxWidth = `${Math.max(0, right - left)}px`;
      menu.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const rect = menu.getBoundingClientRect();
      const base = origin.getBoundingClientRect();
      const x = Math.max(left, Math.min(anchor.x, right - rect.width));
      const preferredY = anchor.top - rect.height - 8;
      const y = Math.max(top, Math.min(preferredY >= top ? preferredY : anchor.bottom + 8, bottom - rect.height));
      menu.style.left = `${x - base.left}px`;
      menu.style.top = `${y - base.top}px`;
      menu.style.visibility = 'visible';
      // Track dialog transforms and zoom only while the popup is open.
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [anchor, container]);

  React.useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      if (!editor.isDestroyed) editor.view.focus();
    };
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    // Capture before the dialog's document-level Escape handler.
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, editor, onClose]);

  if (!anchor) return null;
  return createPortal(
    <div ref={originRef} className="pointer-events-none fixed start-0 inset-bs-0 z-[70]">
      <div ref={menuRef} data-format-menu data-editor-owner={ownerId}
        style={{ position: 'absolute', visibility: 'hidden' }}
        className="pointer-events-auto w-max overflow-y-auto rounded-lg bg-popover p-1.5 text-popover-foreground shadow-menu"
      >
        <FormatMenu editor={editor} getRange={getRange} />
      </div>
    </div>, container,
  );
}
