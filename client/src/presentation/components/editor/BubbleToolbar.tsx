import * as React from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
  Link2,
  ChevronDown,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Всплывающее меню форматирования по выделению (Notion bubble-меню, см. план Phase 0/0.8):
// «Turn into ▾ | B I U S | code | highlight | link».

function ToolBtn({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-hover hover:text-foreground [&_svg]:size-4',
        active && 'bg-active text-foreground',
      )}
    >
      {children}
    </button>
  );
}

const TURN_INTO = [
  { id: 'p', label: 'Текст', icon: Type, run: (e: Editor) => e.chain().focus().setParagraph().run() },
  { id: 'h1', label: 'Заголовок 1', icon: Heading1, run: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Заголовок 2', icon: Heading2, run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Заголовок 3', icon: Heading3, run: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: 'ul', label: 'Список', icon: List, run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { id: 'ol', label: 'Нумерованный', icon: ListOrdered, run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { id: 'todo', label: 'Задачи', icon: ListChecks, run: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: 'Цитата', icon: Quote, run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
] as const;

export function BubbleToolbar({ editor }: { editor: Editor }): React.ReactElement {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
    }),
  });

  const toggleLink = (): void => {
    if (active.link) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt('Ссылка (URL):');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            title="Преобразовать в…"
          >
            <Type className="size-4" />
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {TURN_INTO.map((it) => (
            <DropdownMenuItem key={it.id} onSelect={() => it.run(editor)}>
              <it.icon className="size-4 text-muted-foreground" />
              {it.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

      <ToolBtn active={active.bold} label="Жирный (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolBtn>
      <ToolBtn active={active.italic} label="Курсив (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolBtn>
      <ToolBtn active={active.underline} label="Подчёркнутый (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon />
      </ToolBtn>
      <ToolBtn active={active.strike} label="Зачёркнутый" onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough />
      </ToolBtn>
      <ToolBtn active={active.code} label="Код" onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code />
      </ToolBtn>
      <ToolBtn active={active.highlight} label="Выделение" onClick={() => editor.chain().focus().toggleMark('highlight').run()}>
        <Highlighter />
      </ToolBtn>

      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

      <ToolBtn active={active.link} label="Ссылка" onClick={toggleLink}>
        <Link2 />
      </ToolBtn>
    </BubbleMenu>
  );
}
