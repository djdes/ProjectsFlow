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
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { TEXT_COLORS, BG_COLORS, type ColorSwatch } from './extensions/colorPalette';
import { placeBeside, type BesideRect } from './FloatingFormatMenu';

// Notion-style меню форматирования. Переиспользуется в плавающем меню (по выделению И по
// правому клику) — контейнер (border/bg/shadow) задаёт вызывающая сторона.
//
// Подменю «Преобразовать в…» и «Цвет» раскрываются КАСКАДОМ — отдельной flyout-панелью
// СБОКУ от основного окна (а не заменяя его содержимое inline). Открываются и по наведению
// (задержка ~120мс), и по клику; курсор свободно переходит между окном и подменю, не
// схлопывая их (close-delay мостит зазор). У каждой кнопки — богатая подсказка (как в Notion):
// стилизованный образец + описание.

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

type Sub = 'turn' | 'color';

/**
 * Содержимое меню форматирования. `onAction` дёргается после применённого действия,
 * чтобы вызывающая сторона могла закрыть popover (в плавающем меню НЕ передаётся —
 * меню остаётся открытым).
 */
export function FormatMenu({
  editor,
  onAction,
  getRange,
}: {
  editor: Editor;
  onAction?: () => void;
  /** Снимок диапазона выделения — восстанавливается перед командой (фокус мог уйти в меню). */
  getRange?: () => { from: number; to: number } | null;
}): React.ReactElement {
  const { animations } = useMotion();
  const [openSub, setOpenSub] = React.useState<Sub | null>(null);
  const mainRef = React.useRef<HTMLDivElement>(null);
  const flyoutRef = React.useRef<HTMLDivElement>(null);
  // Желаемый верх flyout-подменю в координатах вьюпорта — берётся с триггер-кнопки.
  const subAnchorTopRef = React.useRef<number | null>(null);
  const [flyoutPos, setFlyoutPos] = React.useState<{ left: number; top: number; ready: boolean }>({
    left: 0,
    top: 0,
    ready: false,
  });
  // Таймеры hover-intent: открытие с задержкой, закрытие с задержкой (мост через зазор
  // между основным окном и подменю — переход курсора их не схлопывает).
  const openTimer = React.useRef<number | undefined>(undefined);
  const closeTimer = React.useRef<number | undefined>(undefined);

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

  // Позиционирование flyout СБОКУ от основного окна (см. placeBeside). Один проход:
  // дельта точно компенсирует transform-предка. ResizeObserver/смена подменю переклампят.
  const place = React.useCallback(() => {
    const el = flyoutRef.current;
    const main = mainRef.current;
    if (!el || !main) return;
    const mr = main.getBoundingClientRect();
    const anchor: BesideRect = {
      left: mr.left,
      right: mr.right,
      top: subAnchorTopRef.current ?? mr.top,
    };
    const styleLeft = parseFloat(el.style.left) || 0;
    const styleTop = parseFloat(el.style.top) || 0;
    const next = placeBeside(el, anchor);
    if (Math.abs(next.left - styleLeft) < 0.5 && Math.abs(next.top - styleTop) < 0.5) {
      setFlyoutPos((p) => (p.ready ? p : { ...p, ready: true }));
      return;
    }
    setFlyoutPos({ left: next.left, top: next.top, ready: true });
  }, []);

  React.useLayoutEffect(() => {
    if (!openSub) return;
    setFlyoutPos((p) => ({ ...p, ready: false }));
    place();
  }, [openSub, place]);

  React.useEffect(() => {
    if (!openSub || !flyoutRef.current) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(flyoutRef.current);
    return () => ro.disconnect();
  }, [openSub, place]);

  React.useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // fire применяет команду; меню НЕ закрываем (Notion-style: можно навесить несколько
  // форматов подряд — выделение сохраняется). Перед командой восстанавливаем диапазон
  // из снимка (клик по кнопке меню уводит фокус и схлопывает выделение редактора).
  const fire = (fn: () => void): void => {
    if (editor.isDestroyed) return;
    const range = getRange?.();
    if (range && range.from !== range.to) {
      editor.commands.setTextSelection(range);
    }
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

  // === Управление каскадом подменю (hover-intent + клик) ===
  const cancelClose = (): void => window.clearTimeout(closeTimer.current);
  const scheduleClose = (): void => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenSub(null), 220);
  };
  // Захват верха триггер-кнопки (для выравнивания подменю по высоте пункта).
  const captureTop = (el: HTMLElement): void => {
    subAnchorTopRef.current = el.getBoundingClientRect().top;
  };
  const hoverOpen = (sub: Sub, el: HTMLElement): void => {
    cancelClose();
    window.clearTimeout(openTimer.current);
    captureTop(el);
    openTimer.current = window.setTimeout(() => setOpenSub(sub), 120);
  };
  const hoverLeaveTrigger = (): void => {
    window.clearTimeout(openTimer.current); // отменяем отложенное открытие
  };
  const clickToggle = (sub: Sub, el: HTMLElement): void => {
    window.clearTimeout(openTimer.current);
    cancelClose();
    captureTop(el);
    setOpenSub((cur) => (cur === sub ? null : sub));
  };

  // Содержимое активного подменю.
  const renderSub = (): React.ReactNode => {
    if (openSub === 'turn') {
      return (
        <>
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Преобразовать в</div>
          {TURN_INTO.map((it) => (
            <MenuItemTooltip key={it.id} example={it.example} description={it.hint}>
              <button
                type="button"
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
            </MenuItemTooltip>
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
        </>
      );
    }
    // openSub === 'color'
    return (
      <>
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Цвет текста</div>
        {TEXT_COLORS.map((sw) => (
          <MenuItemTooltip
            key={`t-${sw.id}`}
            description={`Цвет текста: ${sw.label}`}
            example={
              <span className="text-base font-medium" style={{ color: sw.value ?? undefined }}>
                Образец текста
              </span>
            }
          >
            <button type="button" onMouseDown={(e) => { e.preventDefault(); setTextColor(sw); }} className={ROW}>
              <ColorDot swatch={sw} kind="text" />
              <span className="flex-1 truncate">{sw.label}</span>
              {active.textColor === sw.value || (sw.value === null && !active.textColor) ? (
                <Check className="size-4 text-foreground" />
              ) : null}
            </button>
          </MenuItemTooltip>
        ))}
        <div className="my-1 h-px bg-border" aria-hidden />
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Цвет фона</div>
        {BG_COLORS.map((sw) => (
          <MenuItemTooltip
            key={`b-${sw.id}`}
            description={`Цвет фона: ${sw.label}`}
            example={
              <span className="rounded px-2 py-0.5 text-sm" style={{ backgroundColor: sw.value ?? undefined }}>
                Образец фона
              </span>
            }
          >
            <button type="button" onMouseDown={(e) => { e.preventDefault(); setBgColor(sw); }} className={ROW}>
              <ColorDot swatch={sw} kind="bg" />
              <span className="flex-1 truncate">{sw.label}</span>
              {active.bgColor === sw.value || (sw.value === null && !active.bgColor) ? (
                <Check className="size-4 text-foreground" />
              ) : null}
            </button>
          </MenuItemTooltip>
        ))}
      </>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      {/* === Основное окно (всегда видно) === */}
      <div
        ref={mainRef}
        className="flex w-60 max-w-[calc(100vw-1.5rem)] flex-col gap-1"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        {/* «Преобразовать в…» — открывает flyout-подменю сбоку */}
        <button
          type="button"
          onMouseEnter={(e) => hoverOpen('turn', e.currentTarget)}
          onMouseLeave={hoverLeaveTrigger}
          onMouseDown={(e) => {
            e.preventDefault();
            clickToggle('turn', e.currentTarget);
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-hover',
            openSub === 'turn' && 'bg-hover',
          )}
        >
          <span className="flex-1 truncate text-left text-muted-foreground">{active.blockLabel}</span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        </button>

        <div className="-mx-1 h-px bg-border" aria-hidden />

        {/* Ряд иконок форматирования + цвет */}
        <div className="flex items-center gap-0.5">
          {/* «Цвет» — открывает flyout-подменю сбоку */}
          <button
            type="button"
            aria-label="Цвет текста и фона"
            onMouseEnter={(e) => hoverOpen('color', e.currentTarget)}
            onMouseLeave={hoverLeaveTrigger}
            onMouseDown={(e) => {
              e.preventDefault();
              clickToggle('color', e.currentTarget);
            }}
            className={cn(
              'flex h-7 items-center gap-0.5 rounded-md px-1.5 text-muted-foreground transition-colors',
              'hover:bg-hover hover:text-foreground',
              (active.textColor || active.bgColor) && 'text-foreground',
              openSub === 'color' && 'bg-hover text-foreground',
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

          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

          {FORMAT_BTNS.map((b) => (
            <MenuItemTooltip key={b.id} side="top" example={b.example} description={b.hint}>
              <button
                type="button"
                aria-label={b.label}
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
            </MenuItemTooltip>
          ))}
        </div>
      </div>

      {/* === Flyout-подменю СБОКУ (каскад) === */}
      {openSub && (
        <div
          ref={flyoutRef}
          data-format-menu
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            left: flyoutPos.left,
            top: flyoutPos.top,
            visibility: flyoutPos.ready ? 'visible' : 'hidden',
            maxHeight: `calc(100vh - 16px)`,
          }}
          className={cn(
            'z-[72] flex w-60 max-w-[calc(100vw-1.5rem)] flex-col overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-none',
            animations && 'animate-in fade-in-0 zoom-in-95',
          )}
        >
          {renderSub()}
        </div>
      )}
    </TooltipProvider>
  );
}
