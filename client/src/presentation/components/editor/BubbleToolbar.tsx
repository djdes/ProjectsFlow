import * as React from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';

import { FormatMenu } from './FormatMenu';

// Bubble-меню форматирования по выделению (Notion-style вертикальный popover).
// Содержимое — общий <FormatMenu> (тот же, что и в контекстном меню по правому клику):
// «Преобразовать в…» → ряд иконок (цвет · B I U S ссылка код выделение).
export function BubbleToolbar({ editor }: { editor: Editor }): React.ReactElement {
  return (
    <BubbleMenu
      editor={editor}
      className="rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <FormatMenu editor={editor} />
    </BubbleMenu>
  );
}
