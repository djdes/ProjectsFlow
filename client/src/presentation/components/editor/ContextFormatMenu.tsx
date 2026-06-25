import * as React from 'react';
import type { Editor } from '@tiptap/react';

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { FormatMenu } from './FormatMenu';

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
}

// Контекстное меню форматирования по правому клику внутри редактора. Позиционируется
// у курсора через невидимый PopoverAnchor (фиксированные координаты события). Содержимое —
// тот же <FormatMenu>, что и в bubble-меню (DRY). Закрывается после действия / клика вне.
export function ContextFormatMenu({
  editor,
  state,
  onClose,
}: {
  editor: Editor;
  state: ContextMenuState;
  onClose: () => void;
}): React.ReactElement {
  const { animations } = useMotion();

  return (
    <Popover open={state.open} onOpenChange={(o) => !o && onClose()}>
      {/* Невидимый якорь в точке клика (fixed — координаты viewport'а). */}
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{ position: 'fixed', left: state.x, top: state.y, width: 0, height: 0 }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        // Не возвращаем фокус в редактор автоматически — это сбивало бы выделение слова.
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={animations ? undefined : 'animate-none data-[state=closed]:animate-none'}
      >
        <FormatMenu editor={editor} onAction={onClose} />
      </PopoverContent>
    </Popover>
  );
}
