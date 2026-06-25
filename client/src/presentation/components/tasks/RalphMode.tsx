import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MetaChip } from './MetaChip';
import { RALPH_MODE_META, RALPH_MODES, type RalphMode } from '@/domain/task/Task';

// Селектор режима Ralph — нейтрально стилизованный dropdown с двустрочными элементами
// (label + описание). Используется и в форме создания, и в форме редактирования задачи.
// Размер кнопки контролирует caller через className; variant='ghost' — тихий чип-вид
// для ряда свойств в шапке TaskDrawer'а. См. spec task-ralph-mode.md.
export function RalphModeSelect({
  value,
  onChange,
  disabled,
  className,
  variant = 'outline',
  iconOnly = false,
  showCaret = false,
  chip = false,
}: {
  value: RalphMode;
  onChange: (next: RalphMode) => void;
  disabled?: boolean;
  className?: string;
  variant?: 'outline' | 'ghost';
  // Компактный вид для композеров: только эмодзи-иконка режима, label в title.
  iconOnly?: boolean;
  // В iconOnly-режиме показать маленькую каретку (для чипа-режима в шапке дравера).
  showCaret?: boolean;
  // Notion-style чип для ряда свойств шапки задачи: текст «Режим» (для дефолта) или
  // имя режима + эмодзи + каретка, единый вид с MetaChip (h-7 rounded-md px-2 text-xs).
  chip?: boolean;
}): React.ReactElement {
  const meta = RALPH_MODE_META[value];
  // Чип-режим: по умолчанию (normal) показываем нейтральное «Режим», иначе — имя режима.
  const chipLabel = value === 'normal' ? 'Режим' : meta.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {chip ? (
          <MetaChip
            label={
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true">{meta.icon}</span>
                <span className="truncate">{chipLabel}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </span>
            }
            filled={value !== 'normal'}
            showPlusWhenEmpty={false}
            disabled={disabled}
            title={`Режим воркера: ${meta.label}`}
            className={className}
          />
        ) : (
          <Button
            type="button"
            variant={variant}
            disabled={disabled}
            title={`Режим воркера: ${meta.label}`}
            className={cn(iconOnly ? 'justify-center' : 'w-full justify-between', 'font-normal', className)}
          >
            {iconOnly ? (
              <>
                <span aria-hidden="true" className="text-base leading-none">{meta.icon}</span>
                {showCaret && <ChevronDown className="size-3 shrink-0 opacity-60" />}
              </>
            ) : (
              <>
                <span className="flex items-center gap-2 truncate">
                  <span aria-hidden="true">{meta.icon}</span>
                  <span className="truncate">{meta.label}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 opacity-60" />
              </>
            )}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[280px]">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as RalphMode)}>
          {RALPH_MODES.map((mode) => {
            const m = RALPH_MODE_META[mode];
            return (
              <DropdownMenuRadioItem key={mode} value={mode} className="items-start py-2 pr-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span aria-hidden="true">{m.icon}</span>
                    {m.label}
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {m.description}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Компактный бейдж режима — для карточки задачи / шапки диалога. Нейтрально-серый,
// иконка слева, лейбл справа. На title — описание из spec'а (нативный tooltip).
// Не рендерим 'normal' по умолчанию (визуальный шум для дефолта) — caller передаёт
// showDefault если нужно показать всегда.
export function RalphModeBadge({
  mode,
  showDefault = false,
  className,
}: {
  mode: RalphMode;
  showDefault?: boolean;
  className?: string;
}): React.ReactElement | null {
  if (mode === 'normal' && !showDefault) return null;
  const m = RALPH_MODE_META[mode];
  return (
    <span
      title={m.description}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ${className ?? ''}`}
    >
      <span aria-hidden="true">{m.icon}</span>
      <span>{m.label}</span>
    </span>
  );
}
