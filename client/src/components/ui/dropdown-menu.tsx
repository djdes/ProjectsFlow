import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MobileSheetHandle,
  useMobileSheet,
  useMobileSheetSurface,
} from './mobile-sheet';

const MobileMenuContext = React.createContext<{
  mobile: boolean;
  close: () => void;
  toggle: () => void;
}>({ mobile: false, close: () => {}, toggle: () => {} });
export function DropdownMenu({
  open,
  defaultOpen = false,
  onOpenChange,
  mobileSheet = true,
  modal = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root> & {
  mobileSheet?: boolean;
}): React.ReactElement {
  const mobile = useMobileSheet(mobileSheet);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const change = (next: boolean): void => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return (
    <MobileMenuContext.Provider
      value={{ mobile, close: () => change(false), toggle: () => change(!isOpen) }}
    >
      <DropdownMenuPrimitive.Root
        {...props}
        modal={mobile || modal}
        open={isOpen}
        onOpenChange={change}
      />
    </MobileMenuContext.Provider>
  );
}

/**
 * Radix открывает меню уже на pointerdown — для мыши это правильно (нажал, повёл, отпустил
 * на пункте). Но на телефоне меню — нижний лист, и он появляется ПОД пальцем ещё до того,
 * как палец оторвался: click того же тапа прилетал в пункт листа (тап по «Сроку» сам
 * выставлял «Завтра» и сохранял задачу) или в подложку (лист закрывался, не успев открыться).
 * Поэтому в режиме листа палец и стилус открывают меню по click — после тапа, а не посреди
 * него. Мышь и клавиатура работают как раньше. Заодно начатая на кнопке прокрутка больше не
 * открывает меню: у скролла нет click.
 */
export const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(function DropdownMenuTrigger({ onPointerDown, onClick, ...props }, ref) {
  const { mobile, toggle } = React.useContext(MobileMenuContext);
  const touchPress = React.useRef(false);
  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        touchPress.current = false;
        if (event.defaultPrevented || !mobile || event.pointerType === 'mouse') return;
        touchPress.current = true;
        // Отменённый pointerdown Radix пропускает — открытие переезжает в onClick ниже.
        event.preventDefault();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!touchPress.current) return;
        touchPress.current = false;
        if (event.defaultPrevented || props.disabled) return;
        toggle();
      }}
    />
  );
});
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        // [&_svg]:size-4 — как у DropdownMenuItem: иначе иконка sub-триггера рендерится
        // дефолтными 24px (крупнее пунктов-соседей). shrink-0 — не даёт иконке тянуться.
        'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-hover data-[state=open]:bg-hover sm:py-1 sm:text-ui [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'ps-8',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ms-auto h-4 w-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubContent
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.SubContent
      data-pf-motion-surface="menu"
      className={cn(
        'z-50 min-w-[8rem] overflow-clip rounded-lg bg-popover p-1 text-popover-foreground shadow-menu data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  collisionPadding = 12,
  children,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
>): React.ReactElement {
  const { mobile, close } = React.useContext(MobileMenuContext);
  const { ref: surfaceRef, closeRef } = useMobileSheetSurface(mobile);
  return (
    <>
      {mobile && (
        <DropdownMenuPrimitive.Portal>
          <div
            aria-hidden="true"
            data-pf-mobile-backdrop="true"
            onClick={close}
          />
        </DropdownMenuPrimitive.Portal>
      )}
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={surfaceRef}
          data-pf-mobile-sheet={mobile || undefined}
          data-pf-motion-surface="menu"
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cn(
            'z-50 max-h-[calc(100dvh-1.5rem)] min-w-[8rem] overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-menu data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none',
            className,
          )}
          {...props}
        >
          {mobile && (
            <MobileSheetHandle
              ref={closeRef}
              onClick={close}
              tabIndex={-1}
              role="menuitem"
            />
          )}
          {mobile ? (
            <div className="pf-mobile-sheet-scroll">{children}</div>
          ) : (
            children
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-hover focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 sm:py-1 sm:text-ui [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'ps-8',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioItem
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        'relative flex cursor-default select-none items-center rounded-sm py-1.5 ps-8 pe-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.CheckboxItem
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'relative flex cursor-default select-none items-center rounded-sm py-1.5 ps-8 pe-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-2 py-1 text-xs font-medium text-muted-foreground',
        inset && 'ps-8',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Separator
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  return (
    <span
      className={cn('ms-auto text-xs tracking-widest opacity-60', className)}
      {...props}
    />
  );
}
