import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EyeOff, ListChecks, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { KanbanColor, VisibleKanbanStatus } from '@/domain/kanban/KanbanSettings';
import { KanbanColorPicker } from './KanbanColorPicker';

type Props = {
  status: VisibleKanbanStatus;
  // Текущий резолвнутый цвет колонки (для подсветки активного свотча).
  currentColor: KanbanColor;
  // Текущий резолвнутый заголовок (дефолтный или переименованный).
  currentLabel: string;
  onColor: (color: KanbanColor) => void;
  onLabel: (label: string) => void;
  onHide: () => void;
  // Включить режим мультивыделения карточек ЭТОЙ колонки (Telegram-стиль).
  onSelect: () => void;
};

// Меню колонки (троеточие, как в Notion): переименование, выбор цвета, скрытие.
// Переименование меняет ТОЛЬКО подпись — внутренний status-ключ и логика не трогаются.
export function KanbanColumnMenu({
  status,
  currentColor,
  currentLabel,
  onColor,
  onLabel,
  onHide,
  onSelect,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(currentLabel);
  const inputRef = useRef<HTMLInputElement>(null);

  // При открытии меню засеваем поле текущим заголовком и фокусируем его.
  useEffect(() => {
    if (open) {
      setLabelDraft(currentLabel);
      // Контент Radix монтируется при open=true; фокус после кадра, чтобы поле уже было в DOM.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, currentLabel]);

  const commitLabel = (): void => {
    const next = labelDraft.trim();
    if (next !== currentLabel) onLabel(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // Глушим typeahead Radix-меню; Enter — сохранить+закрыть, Esc — отменить+закрыть.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitLabel();
      setOpen(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setLabelDraft(currentLabel);
      setOpen(false);
    }
  };

  const handleHide = (): void => {
    // todo-колонка показывает in_progress/awaiting_clarification — предупреждаем.
    if (status === 'todo') {
      const ok = window.confirm(
        'В колонке «ВОРКЕР» отображаются задачи в работе и на уточнении. ' +
          'Если скрыть её, эти задачи пропадут с доски (вернутся при показе колонки). Скрыть?',
      );
      if (!ok) return;
    }
    onHide();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" aria-label="Настройки колонки">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2 py-1.5" onKeyDown={handleKeyDown}>
          <input
            ref={inputRef}
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            placeholder="Название колонки"
            maxLength={40}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:border-foreground/30 focus:outline-none"
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Цвет
        </DropdownMenuLabel>
        <div className="px-2 pb-1.5 pt-1">
          <KanbanColorPicker value={currentColor} onChange={onColor} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onSelect();
          }}
        >
          <ListChecks className="size-4" />
          Выделить
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleHide}
          className="text-destructive focus:text-destructive"
        >
          <EyeOff className="size-4" />
          Скрыть колонку
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
