import * as React from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
  Link2,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Minus,
  Baseline,
  Eraser,
  Check,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TEXT_COLORS, BG_COLORS, type ColorSwatch } from './extensions/colorPalette';

// Notion-style вертикальное меню форматирования. Переиспользуется в bubble-меню (по выделению)
// и контекстном меню (правый клик). Контейнер (border/bg/shadow) задаёт вызывающая сторона.
//
// Подменю «Преобразовать в…» и «Цвет» раскрываются INLINE (внутри того же floating-меню),
// а НЕ во вложенном Radix-портале. Это чинит баг, когда вложенное меню открывалось в углу
// экрана (0,0): портал терял якорь внутри tippy/popover-обёртки. Inline-панели всегда на месте.

interface TurnIntoItem {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: (e: Editor) => void;
  isActive: (e: Editor) => boolean;
}

const TURN_INTO: TurnIntoItem[] = [
  {
    id: 'p',
    label: 'Текст',
    hint: 'Обычный текст абзаца.',
    icon: Type,
    run: (e) => e.chain().focus().setParagraph().run(),
    isActive: (e) => e.isActive('paragraph') && !e.isActive('bulletList') && !e.isActive('orderedList'),
  },
  {
    id: 'h1',
    label: 'Заголовок 1',
    hint: 'Большой заголовок раздела.',
    icon: Heading1,
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    id: 'h2',
    label: 'Заголовок 2',
    hint: 'Средний заголовок подраздела.',
    icon: Heading2,
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    id: 'h3',
    label: 'Заголовок 3',
    hint: 'Маленький заголовок.',
    icon: Heading3,
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive('heading', { level: 3 }),
  },
  {
    id: 'ul',
    label: 'Маркированный список',
    hint: 'Список с маркерами.',
    icon: List,
    run: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    id: 'ol',
    label: 'Нумерованный список',
    hint: 'Список с нумерацией.',
    icon: ListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive('orderedList'),
  },
  {
    id: 'todo',
    label: 'Список задач',
    hint: 'Чек-лист с галочками.',
    icon: ListChecks,
    run: (e) => e.chain().focus().toggleTaskList().run(),
    isActive: (e) => e.isActive('taskList'),
  },
  {
    id: 'quote',
    label: 'Цитата',
    hint: 'Выделенная цитата.',
    icon: Quote,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote'),
  },
  {
    id: 'code',
    label: 'Блок кода',
    hint: 'Блок кода с моноширинным шрифтом.',
    icon: Code2,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
    isActive: (e) => e.isActive('codeBlock'),
  },
  {
    id: 'divider',
    label: 'Разделитель',
    hint: 'Горизонтальная линия между блоками.',
    icon: Minus,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
    isActive: () => false,
  },
];

interface FormatBtn {
  id: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'highlight' | 'link';
  tooltip: string;
  icon: LucideIcon;
}

const FORMAT_BTNS: FormatBtn[] = [
  { id: 'bold', tooltip: 'Жирный · Ctrl+B', icon: Bold },
  { id: 'italic', tooltip: 'Курсив · Ctrl+I', icon: Italic },
  { id: 'underline', tooltip: 'Подчёркнутый · Ctrl+U', icon: UnderlineIcon },
  { id: 'strike', tooltip: 'Зачёркнутый · Ctrl+Shift+S', icon: Strikethrough },
  { id: 'link', tooltip: 'Ссылка · Ctrl+K', icon: Link2 },
  { id: 'code', tooltip: 'Инлайн-код · Ctrl+E', icon: Code },
  { id: 'highlight', tooltip: 'Выделение фоном', icon: Highlighter },
];

function ColorDot({ swatch, kind }: { swatch: ColorSwatch; kind: 'text' | 'bg' }): React.ReactElement {
  if (kind === 'text') {
    return (
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded border text-[13px] font-medium"
        style={{ color: swatch.value ?? undefined }}
        aria-hidden
      >
        А
      </span>
    );
  }
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded border"
      style={{ backgroundColor: swatch.value ?? undefined }}
      aria-hidden
    >
      {swatch.value ? null : <Baseline className="size-3 text-muted-foreground" />}
    </span>
  );
}

const ROW =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover';

type Panel = 'main' | 'turn' | 'color';

/**
 * Содержимое меню форматирования. `onAction` дёргается после применённого действия,
 * чтобы вызывающая сторона могла закрыть popover (контекстное меню).
 */
export function FormatMenu({
  editor,
  onAction,
}: {
  editor: Editor;
  onAction?: () => void;
}): React.ReactElement {
  const [panel, setPanel] = React.useState<Panel>('main');

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
      blockLabel: (TURN_INTO.find((it) => it.id !== 'p' && it.id !== 'divider' && it.isActive(e))?.label) ?? 'Обычный текст',
      textColor: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      bgColor: (e.getAttributes('textStyle').backgroundColor as string | undefined) ?? null,
    }),
  });

  // fire применяет команду и закрывает меню; guard против разрушенного editor.
  const fire = (fn: () => void): void => {
    if (editor.isDestroyed) return;
    fn();
    onAction?.();
  };

  const toggleFormat = (id: FormatBtn['id']): void => {
    if (id === 'link') {
      if (active.link) {
        fire(() => editor.chain().focus().unsetLink().run());
        return;
      }
      const url = window.prompt('Ссылка (URL):');
      if (url) fire(() => editor.chain().focus().setLink({ href: url }).run());
      return;
    }
    if (id === 'highlight') return fire(() => editor.chain().focus().toggleMark('highlight').run());
    if (id === 'bold') return fire(() => editor.chain().focus().toggleBold().run());
    if (id === 'italic') return fire(() => editor.chain().focus().toggleItalic().run());
    if (id === 'underline') return fire(() => editor.chain().focus().toggleUnderline().run());
    if (id === 'strike') return fire(() => editor.chain().focus().toggleStrike().run());
    if (id === 'code') return fire(() => editor.chain().focus().toggleCode().run());
  };

  const setTextColor = (sw: ColorSwatch): void =>
    sw.value === null
      ? fire(() => editor.chain().focus().unsetColor().run())
      : fire(() => editor.chain().focus().setColor(sw.value as string).run());
  const setBgColor = (sw: ColorSwatch): void =>
    sw.value === null
      ? fire(() => editor.chain().focus().unsetBackgroundColor().run())
      : fire(() => editor.chain().focus().setBackgroundColor(sw.value as string).run());

  const backHeader = (title: string): React.ReactElement => (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        setPanel('main');
      }}
      className="mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-hover"
    >
      <ChevronLeft className="size-3.5" />
      {title}
    </button>
  );

  // === Панель «Преобразовать в…» (inline) ===
  if (panel === 'turn') {
    return (
      <div className="flex w-60 max-w-[calc(100vw-1.5rem)] flex-col">
        {backHeader('Преобразовать в')}
        <div className="max-h-[60vh] overflow-y-auto">
          {TURN_INTO.map((it) => (
            <button
              key={it.id}
              type="button"
              title={it.hint}
              onMouseDown={(e) => {
                e.preventDefault();
                fire(() => it.run(editor));
              }}
              className={ROW}
            >
              <it.icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{it.label}</span>
              {it.isActive(editor) ? <Check className="size-4 text-foreground" /> : null}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              fire(() => editor.chain().focus().unsetAllMarks().clearNodes().run());
            }}
            className={cn(ROW, 'text-muted-foreground')}
          >
            <Eraser className="size-4 shrink-0" />
            <span className="flex-1 truncate">Очистить форматирование</span>
          </button>
        </div>
      </div>
    );
  }

  // === Панель «Цвет» (inline) ===
  if (panel === 'color') {
    return (
      <div className="flex w-60 max-w-[calc(100vw-1.5rem)] flex-col">
        {backHeader('Цвет')}
        <div className="max-h-[60vh] overflow-y-auto">
          <div className="px-2 py-1 text-xs text-muted-foreground">Цвет текста</div>
          {TEXT_COLORS.map((sw) => (
            <button key={`t-${sw.id}`} type="button" onMouseDown={(e) => { e.preventDefault(); setTextColor(sw); }} className={ROW}>
              <ColorDot swatch={sw} kind="text" />
              <span className="flex-1 truncate">{sw.label}</span>
              {active.textColor === sw.value || (sw.value === null && !active.textColor) ? (
                <Check className="size-4 text-foreground" />
              ) : null}
            </button>
          ))}
          <div className="my-1 h-px bg-border" aria-hidden />
          <div className="px-2 py-1 text-xs text-muted-foreground">Цвет фона</div>
          {BG_COLORS.map((sw) => (
            <button key={`b-${sw.id}`} type="button" onMouseDown={(e) => { e.preventDefault(); setBgColor(sw); }} className={ROW}>
              <ColorDot swatch={sw} kind="bg" />
              <span className="flex-1 truncate">{sw.label}</span>
              {active.bgColor === sw.value || (sw.value === null && !active.bgColor) ? (
                <Check className="size-4 text-foreground" />
              ) : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // === Главная панель ===
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex w-60 max-w-[calc(100vw-1.5rem)] flex-col gap-1">
        {/* «Преобразовать в…» — открывает inline-панель */}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setPanel('turn');
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-hover"
        >
          <span className="flex-1 truncate text-left text-muted-foreground">{active.blockLabel}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>

        <div className="-mx-1 h-px bg-border" aria-hidden />

        {/* Ряд иконок форматирования + цвет */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Цвет"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setPanel('color');
                }}
                className={cn(
                  'flex h-7 items-center gap-0.5 rounded-md px-1.5 text-muted-foreground transition-colors',
                  'hover:bg-hover hover:text-foreground',
                  (active.textColor || active.bgColor) && 'text-foreground',
                )}
              >
                <span
                  className="text-[15px] font-medium leading-none"
                  style={{ color: active.textColor ?? undefined, backgroundColor: active.bgColor ?? undefined }}
                >
                  A
                </span>
                <ChevronRight className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Цвет текста и фона</TooltipContent>
          </Tooltip>

          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

          {FORMAT_BTNS.map((b) => (
            <Tooltip key={b.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={b.tooltip}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleFormat(b.id);
                  }}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
                    'hover:bg-hover hover:text-foreground [&_svg]:size-4',
                    active[b.id] && 'bg-active text-foreground',
                  )}
                >
                  <b.icon />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{b.tooltip}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
