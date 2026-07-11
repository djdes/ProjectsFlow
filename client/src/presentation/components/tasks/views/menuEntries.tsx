import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

// ============ Данные-описание меню (Notion-style) ============
// Одна спека рендерится и в DropdownMenu (клик по активной вкладке / шеврону / «⋯»),
// и в ContextMenu (правая кнопка мыши) — в Notion это одно и то же меню.

export type MenuEntry =
  | {
      kind: 'item';
      label: string;
      icon?: LucideIcon;
      // Цветная точка вместо иконки (статусы/приоритеты).
      dotClass?: string;
      destructive?: boolean;
      muted?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { kind: 'sub'; label: string; icon?: LucideIcon; items: MenuEntry[] }
  | { kind: 'separator' }
  | { kind: 'label'; label: string };

function itemInner(e: Extract<MenuEntry, { kind: 'item' }>): React.ReactNode {
  return (
    <>
      {e.icon && <e.icon className="size-4" />}
      {e.dotClass && <span className={cn('size-2 rounded-full', e.dotClass)} />}
      {e.label}
      {e.checked && <Check className="ml-auto size-3.5" />}
    </>
  );
}

export function DropdownEntries({ entries }: { entries: MenuEntry[] }): React.ReactElement {
  return (
    <>
      {entries.map((e, i) => {
        if (e.kind === 'separator') return <DropdownMenuSeparator key={i} />;
        if (e.kind === 'label')
          return (
            <DropdownMenuLabel key={i} className="text-xs font-normal text-muted-foreground">
              {e.label}
            </DropdownMenuLabel>
          );
        if (e.kind === 'sub')
          return (
            <DropdownMenuSub key={i}>
              <DropdownMenuSubTrigger className="gap-2">
                {e.icon && <e.icon className="size-4" />}
                {e.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[11rem]">
                <DropdownEntries entries={e.items} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        return (
          <DropdownMenuItem
            key={i}
            className={cn(
              'gap-2',
              e.destructive && 'text-destructive focus:text-destructive',
              e.muted && 'text-muted-foreground',
            )}
            onSelect={e.onSelect}
          >
            {itemInner(e)}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

export function ContextEntries({ entries }: { entries: MenuEntry[] }): React.ReactElement {
  return (
    <>
      {entries.map((e, i) => {
        if (e.kind === 'separator') return <ContextMenuSeparator key={i} />;
        if (e.kind === 'label')
          return (
            <ContextMenuLabel key={i} className="text-xs font-normal text-muted-foreground">
              {e.label}
            </ContextMenuLabel>
          );
        if (e.kind === 'sub')
          return (
            <ContextMenuSub key={i}>
              <ContextMenuSubTrigger className="gap-2">
                {e.icon && <e.icon className="size-4" />}
                {e.label}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[11rem]">
                <ContextEntries entries={e.items} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          );
        return (
          <ContextMenuItem
            key={i}
            className={cn(
              'gap-2',
              e.destructive && 'text-destructive focus:text-destructive',
              e.muted && 'text-muted-foreground',
            )}
            onSelect={e.onSelect}
          >
            {itemInner(e)}
          </ContextMenuItem>
        );
      })}
    </>
  );
}
