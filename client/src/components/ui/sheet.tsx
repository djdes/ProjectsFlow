import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MobileSheetHandle,
  useMobileSheet,
  useMobileSheetSurface,
} from './mobile-sheet';

export function Sheet({
  modal = true,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Root
>): React.ReactElement {
  const mobile = useMobileSheet();
  return <DialogPrimitive.Root {...props} modal={mobile || modal} />;
}
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export function SheetOverlay({
  className,
  dimmed = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
  dimmed?: boolean;
}): React.ReactElement {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        // dimmed (center-peek, модально): затемняющий фон + клики ловятся (клик мимо закрывает).
        // Иначе (side-peek): прозрачный + pointer-events-none — клики «проходят» сквозь оверлей
        // к остальному приложению (немодальные правые окна — тыкать весь сайт, как в Notion).
        dimmed ? 'bg-black/40 backdrop-blur-[1px]' : 'pointer-events-none',
        className,
      )}
      {...props}
    />
  );
}

const sheetVariants = cva(
  // shadow-2xl (а не shadow-lg): без затемнения панель должна отделяться от фона тенью.
  'fixed z-50 gap-4 bg-background p-6 shadow-2xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
  {
    variants: {
      side: {
        top: 'inset-x-0 inset-bs-0 border-be motion-safe:data-[state=closed]:slide-out-to-top motion-safe:data-[state=open]:slide-in-from-top',
        bottom:
          'inset-x-0 inset-be-0 border-bs motion-safe:data-[state=closed]:slide-out-to-bottom motion-safe:data-[state=open]:slide-in-from-bottom',
        left: 'inset-y-0 start-0 h-full w-3/4 border-e motion-safe:data-[state=closed]:slide-out-to-left motion-safe:data-[state=open]:slide-in-from-left sm:max-w-sm',
        right:
          'inset-y-0 end-0 h-full w-3/4 border-s motion-safe:data-[state=closed]:slide-out-to-right motion-safe:data-[state=open]:slide-in-from-right sm:max-w-sm',
        // center: модальное окно по центру (Notion «center peek»). Центрирование +
        // zoom-анимация. Скругление/рамка/высота задаются через className вызывающего.
        center:
          'start-1/2 inset-bs-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:slide-out-to-bottom-2 motion-safe:data-[state=open]:slide-in-from-bottom-2',
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
);

export interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  // По умолчанию рисуем встроенный крестик. Если у контента своя кнопка закрытия
  // (напр. в собственной шапке) — передай showClose={false}, чтобы не было двух крестиков.
  showClose?: boolean;
  // dimmed: затемняющий фон + клик мимо закрывает (модальный center-peek).
  dimmed?: boolean;
  mobileSheet?: boolean;
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  {
    side = 'right',
    className,
    children,
    showClose = true,
    dimmed = false,
    mobileSheet = true,
    ...props
  },
  ref,
) {
  const mobile = useMobileSheet(mobileSheet);
  const { ref: surfaceRef, closeRef } = useMobileSheetSurface(mobile, ref);
  return (
    <SheetPortal>
      <SheetOverlay
        dimmed={dimmed}
        data-pf-mobile-backdrop={mobile || undefined}
      />
      <DialogPrimitive.Content
        data-pf-motion-surface="sheet"
        data-pf-mobile-sheet={mobile || undefined}
        ref={surfaceRef}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {mobile && (
          <DialogPrimitive.Close asChild>
            <MobileSheetHandle ref={closeRef} />
          </DialogPrimitive.Close>
        )}
        {children}
        {showClose && (
          <DialogPrimitive.Close
            data-pf-window-close=""
            className="absolute end-3 inset-bs-3 grid size-7 place-items-center rounded-md text-muted-foreground ring-offset-background transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col space-y-2 text-center sm:text-start',
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Title
>): React.ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
>): React.ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
