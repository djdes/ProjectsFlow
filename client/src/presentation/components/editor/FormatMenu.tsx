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
  ChevronDown,
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
  Check,
  Eraser,
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

// Shared controls for the visible toolbar and selection/context popup.
// Block, color and link panels expand inline; pointer and keyboard actions keep
// the editor selection intact, with pressed/expanded states exposed to assistive tools.

interface TurnIntoItem {
  id: string;
  label: string;
  hint: string;
  example: React.ReactNode;
  icon: LucideIcon;
  run: (e: Editor) => void;
  isActive: (e: Editor) => boolean;
}

const TURN_INTO: TurnIntoItem[] = [
  {
    id: 'p',
    label: 'Текст',
    hint: 'Обычный текст абзаца.',
    example: <span className="text-sm">Текст абзаца</span>,
    icon: Type,
    run: (e) => e.chain().focus().setParagraph().run(),
    isActive: (e) => e.isActive('paragraph') && !e.isActive('bulletList') && !e.isActive('orderedList'),
  },
  {
    id: 'h1',
    label: 'Заголовок 1',
    hint: 'Большой заголовок раздела.',
    example: <span className="block text-lg font-semibold leading-tight">Большой заголовок</span>,
    icon: Heading1,
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    id: 'h2',
    label: 'Заголовок 2',
    hint: 'Средний заголовок подраздела.',
    example: <span className="block text-base font-semibold leading-tight">Средний заголовок</span>,
    icon: Heading2,
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    id: 'h3',
    label: 'Заголовок 3',
    hint: 'Маленький заголовок.',
    example: <span className="block text-sm font-semibold leading-tight">Маленький заголовок</span>,
    icon: Heading3,
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive('heading', { level: 3 }),
  },
  {
    id: 'ul',
    label: 'Маркированный список',
    hint: 'Список с маркерами.',
    example: (
      <ul className="list-disc space-y-0.5 pl-4 text-xs">
        <li>Первый пункт</li>
        <li>Второй пункт</li>
      </ul>
    ),
    icon: List,
    run: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    id: 'ol',
    label: 'Нумерованный список',
    hint: 'Список с нумерацией.',
    example: (
      <ol className="list-decimal space-y-0.5 pl-4 text-xs">
        <li>Первый пункт</li>
        <li>Второй пункт</li>
      </ol>
    ),
    icon: ListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive('orderedList'),
  },
  {
    id: 'todo',
    label: 'Список задач',
    hint: 'Чек-лист с галочками.',
    example: (
      <div className="space-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="grid size-3.5 place-items-center rounded-[3px] bg-primary text-primary-foreground">
            <Check className="size-2.5" strokeWidth={3} />
          </span>
          Готовая задача
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3.5 rounded-[3px] border" />
          Незавершённая
        </span>
      </div>
    ),
    icon: ListChecks,
    run: (e) => e.chain().focus().toggleTaskList().run(),
    isActive: (e) => e.isActive('taskList'),
  },
  {
    id: 'quote',
    label: 'Цитата',
    hint: 'Выделенная цитата.',
    example: (
      <blockquote className="border-l-2 border-foreground/30 pl-2 text-xs italic text-muted-foreground">
        Выделенная цитата
      </blockquote>
    ),
    icon: Quote,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote'),
  },
  {
    id: 'code',
    label: 'Блок кода',
    hint: 'Блок кода с моноширинным шрифтом.',
    example: (
      <code className="block rounded bg-foreground/10 px-1.5 py-1 font-mono text-[11px] leading-snug">
        const x = 1
      </code>
    ),
    icon: Code2,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
    isActive: (e) => e.isActive('codeBlock'),
  },
  {
    id: 'divider',
    label: 'Разделитель',
    hint: 'Горизонтальная линия между блоками.',
    example: (
      <div className="flex flex-col gap-1 text-xs">
        <span>Текст до</span>
        <span className="h-px w-full bg-border" aria-hidden />
        <span>Текст после</span>
      </div>
    ),
    icon: Minus,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
    isActive: () => false,
  },
];

interface FormatBtn {
  id: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'highlight' | 'link';
  /** aria-label + краткая подпись с горячей клавишей. */
  label: string;
  /** Описание для богатой подсказки. */
  hint: string;
  example: React.ReactNode;
  icon: LucideIcon;
}

const FORMAT_BTNS: FormatBtn[] = [
  {
    id: 'bold',
    label: 'Жирный · Ctrl+B',
    hint: 'Выделить текст жирным начертанием.',
    example: <span className="text-sm font-bold">Жирный текст</span>,
    icon: Bold,
  },
  {
    id: 'italic',
    label: 'Курсив · Ctrl+I',
    hint: 'Наклонное начертание для акцента.',
    example: <span className="text-sm italic">Курсивный текст</span>,
    icon: Italic,
  },
  {
    id: 'underline',
    label: 'Подчёркнутый · Ctrl+U',
    hint: 'Подчеркнуть текст линией.',
    example: <span className="text-sm underline">Подчёркнутый текст</span>,
    icon: UnderlineIcon,
  },
  {
    id: 'strike',
    label: 'Зачёркнутый · Ctrl+Shift+S',
    hint: 'Перечеркнуть текст линией.',
    example: <span className="text-sm line-through">Зачёркнутый текст</span>,
    icon: Strikethrough,
  },
  {
    id: 'link',
    label: 'Ссылка · Ctrl+K',
    hint: 'Превратить выделение в гиперссылку.',
    example: <span className="text-sm text-blue-600 underline dark:text-blue-400">текст ссылки</span>,
    icon: Link2,
  },
  {
    id: 'code',
    label: 'Инлайн-код · Ctrl+E',
    hint: 'Моноширинный фрагмент внутри строки.',
    example: (
      <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[11px]">inline code</code>
    ),
    icon: Code,
  },
  {
    id: 'highlight',
    label: 'Выделение фоном',
    hint: 'Подсветить текст фоновой заливкой.',
    example: (
      <span className="rounded bg-yellow-200 px-1 text-sm text-neutral-900">выделенный текст</span>
    ),
    icon: Highlighter,
  },
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

// Богатая подсказка (как в Notion): стилизованный образец + строка-описание. Портал Radix
// в body, z выше панелей меню (z-[70]). avoidCollisions сам флипнет, если у края экрана.
function MenuItemTooltip({
  example,
  description,
  side = 'right',
  children,
}: {
  example?: React.ReactNode;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactElement;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align="start"
        sideOffset={8}
        className="z-[80] w-56 max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        {example != null && (
          <div className="border-b bg-muted/40 px-3 py-2.5">{example}</div>
        )}
        <div className="px-3 py-2 text-xs leading-snug text-muted-foreground">{description}</div>
      </TooltipContent>
    </Tooltip>
  );
}

type Sub = 'turn' | 'color' | 'link';

/** The same controls work in the task toolbar and the selection popup. */
export function FormatMenu({ editor, getRange, inline = false }: {
  editor: Editor;
  getRange?: () => { from: number; to: number } | null;
  inline?: boolean;
}): React.ReactElement {
  const [openSub, setOpenSub] = React.useState<Sub | null>(null);
  const [linkUrl, setLinkUrl] = React.useState('');
  const [linkError, setLinkError] = React.useState('');
  const panelId = React.useId();
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'),
      strike: e.isActive('strike'), code: e.isActive('code'), highlight: e.isActive('highlight'),
      link: e.isActive('link'),
      blockLabel: TURN_INTO.find(it => it.id !== 'p' && it.id !== 'divider' && it.isActive(e))?.label ?? 'Текст',
      textColor: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      bgColor: (e.getAttributes('textStyle').backgroundColor as string | undefined) ?? null,
    }),
  });
  const fire = (run: () => void): void => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const range = getRange?.();
    if (range) {
      const max = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(range.from, max), to: Math.min(range.to, max) });
    }
    run();
  };
  const toggleFormat = (id: FormatBtn['id']): void => {
    if (id === 'link') {
      setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '');
      setLinkError('');
      setOpenSub(openSub === 'link' ? null : 'link');
      return;
    }
    fire(() => editor.chain().focus().toggleMark(id).run());
  };
  const applyLink = (): void => {
    const value = linkUrl.trim();
    if (value && !/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value)) {
      setLinkError('Укажите ссылку с https://');
      return;
    }
    fire(() => value ? editor.chain().focus().setLink({ href: value }).run() : editor.chain().focus().unsetLink().run());
    setOpenSub(null);
  };
  const selectBlock = (item: TurnIntoItem): void => {
    fire(() => item.run(editor));
    setOpenSub(null);
  };
  return (
    <TooltipProvider delayDuration={650}>
      <div className={cn(inline ? 'w-full' : 'w-[19rem] max-w-[calc(100vw-2rem)]')}>
        <div
          role="toolbar"
          aria-label="Форматирование текста"
          className={cn('flex flex-wrap items-center gap-0.5', inline && 'py-1')}
          onMouseDown={e => e.preventDefault()}
          onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}
        >
          <div className={cn('grid max-w-full grid-cols-7 gap-0.5', inline ? 'max-sm:w-full' : 'w-full')}>
            {FORMAT_BTNS.map(b => (
              <MenuItemTooltip key={b.id} side="top" description={b.label}>
                <button type="button" aria-label={b.label} aria-pressed={active[b.id]}
                  onClick={() => toggleFormat(b.id)}
                  className={cn('grid shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-10 max-sm:w-full [&_svg]:size-4', inline ? 'size-8' : 'h-9 w-full', active[b.id] && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
                ><b.icon /></button>
              </MenuItemTooltip>
            ))}
          </div>
          <div className={cn('flex items-center gap-1', inline ? 'ml-auto' : 'w-full border-t pt-1')}>
            <button type="button" aria-label="Тип блока" aria-expanded={openSub === 'turn'} aria-controls={panelId}
              onClick={() => setOpenSub(openSub === 'turn' ? null : 'turn')}
              className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-10">
              <Type className="size-4 shrink-0" /><span className="truncate">{active.blockLabel}</span><ChevronDown className="size-3.5" />
            </button>
            <button type="button" aria-label="Цвет текста и фона" aria-expanded={openSub === 'color'} aria-controls={panelId}
              onClick={() => setOpenSub(openSub === 'color' ? null : 'color')}
              className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-10">
              <Baseline className="size-4" style={{ color: active.textColor ?? undefined }} />{!inline && <span>Цвет</span>}<ChevronDown className="size-3.5" />
            </button>
          </div>
        </div>
        {openSub && <div id={panelId} className="mt-1 max-h-[min(22rem,45dvh)] overflow-y-auto border-t pt-2">
          {openSub === 'turn' && <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {TURN_INTO.map(item => <button key={item.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => selectBlock(item)}
              aria-pressed={item.isActive(editor)} className={cn(ROW, 'min-h-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', item.isActive(editor) && 'bg-primary/10 text-primary')}>
              <item.icon className="size-4 shrink-0" /><span className="flex-1">{item.label}</span>
            </button>)}
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { fire(() => editor.chain().focus().unsetAllMarks().clearNodes().run()); setOpenSub(null); }} className={cn(ROW, 'min-h-10 sm:col-span-2')}>
              <Eraser className="size-4" />Очистить форматирование
            </button>
          </div>}
          {openSub === 'color' && <div className="space-y-3 px-1 pb-1">
            {([{ kind: 'text', label: 'Цвет текста', colors: TEXT_COLORS }, { kind: 'bg', label: 'Цвет фона', colors: BG_COLORS }] as const).map(group => <div key={group.kind}>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
              <div className="grid grid-cols-5 gap-1">
                {group.colors.map(sw => <button key={sw.id} type="button" aria-label={`${group.label}: ${sw.label}`} title={sw.label}
                  aria-pressed={(group.kind === 'text' ? active.textColor : active.bgColor) === sw.value}
                  onMouseDown={e => e.preventDefault()} onClick={() => { fire(() => { const chain = editor.chain().focus(); if (group.kind === 'text') (sw.value ? chain.setColor(sw.value) : chain.unsetColor()).run(); else (sw.value ? chain.setBackgroundColor(sw.value) : chain.unsetBackgroundColor()).run(); }); }}
                  className="grid min-h-10 place-items-center rounded-md border border-transparent hover:bg-hover aria-pressed:border-primary/50 aria-pressed:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ColorDot swatch={sw} kind={group.kind} />
                </button>)}
              </div>
            </div>)}
          </div>}
          {openSub === 'link' && <div className="space-y-2 p-1">
            <label className="block text-xs font-medium" htmlFor={`${panelId}-url`}>Ссылка</label>
            <input id={`${panelId}-url`} value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setLinkError(''); }} placeholder="https://" autoFocus
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } }}
              aria-invalid={!!linkError} aria-describedby={linkError ? `${panelId}-error` : undefined}
              className="h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            {linkError && <p id={`${panelId}-error`} role="alert" className="text-xs text-destructive">{linkError}</p>}
            <div className="flex justify-end gap-2">
              {active.link && <button type="button" onClick={() => { fire(() => editor.chain().focus().unsetLink().run()); setOpenSub(null); }} className="rounded-md px-3 py-2 text-sm hover:bg-hover">Убрать ссылку</button>}
              <button type="button" onClick={applyLink} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Применить</button>
            </div>
          </div>}
        </div>}
      </div>
    </TooltipProvider>
  );
}
