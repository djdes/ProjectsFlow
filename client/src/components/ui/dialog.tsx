import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MobileSheetHandle,
  useMobileSheet,
  useMobileSheetSurface,
} from './mobile-sheet';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Overlay
>): React.ReactElement {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        // Без затемнения (по запросу): оверлей прозрачный, но остаётся в DOM — клик
        // мимо окна по-прежнему его закрывает (Radix вешает обработчик на overlay).
        'fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  overlayClassName,
  hideClose,
  mobileSheet = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  // По умолчанию overlay прозрачный. Отдельные тяжёлые окна (например, история версий)
  // могут включить собственное затемнение, не меняя внешний вид всех остальных Dialog.
  overlayClassName?: string;
  // Окна со своей шапкой (лайтбоксы превью) рисуют кнопку закрытия сами, в ряду заголовка.
  // Встроенная абсолютная «×» ложилась поверх неё — пользователь видел двойной крестик.
  hideClose?: boolean;
  mobileSheet?: boolean;
}): React.ReactElement {
  const mobile = useMobileSheet(mobileSheet);
  const { ref: surfaceRef, closeRef } = useMobileSheetSurface(mobile);
  return (
    <DialogPortal>
      <DialogOverlay
        className={overlayClassName}
        data-pf-mobile-backdrop={mobile || undefined}
      />
      <DialogPrimitive.Content
        ref={surfaceRef}
        data-pf-mobile-sheet={mobile || undefined}
        data-pf-motion-surface="dialog"
        className={cn(
          // Mobile: прижат к низу экрана (bottom-sheet), безопасен для клавиатуры.
          // Desktop (sm+): классический центрированный диалог.
          'fixed inset-x-0 inset-be-0 z-50 grid w-full max-w-lg gap-4 rounded-bs-xl bg-popover p-5 text-popover-foreground shadow-menu duration-200 max-sm:max-h-[85dvh] max-sm:overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-safe:max-sm:data-[state=closed]:slide-out-to-bottom motion-safe:max-sm:data-[state=open]:slide-in-from-bottom sm:inset-auto sm:start-[50%] sm:inset-bs-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl motion-safe:data-[state=closed]:sm:zoom-out-95 motion-safe:data-[state=open]:sm:zoom-in-95 motion-safe:data-[state=closed]:sm:slide-out-to-left-1/2 motion-safe:data-[state=closed]:sm:slide-out-to-top-[48%] motion-safe:data-[state=open]:sm:slide-in-from-left-1/2 motion-safe:data-[state=open]:sm:slide-in-from-top-[48%]',
          className,
        )}
        {...props}
      >
        {mobile && (
          <DialogPrimitive.Close asChild>
            <MobileSheetHandle ref={closeRef} />
          </DialogPrimitive.Close>
        )}
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            data-pf-window-close=""
            className="absolute end-3 inset-bs-3 grid size-7 place-items-center rounded-md text-muted-foreground ring-offset-background transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col space-y-1.5 text-start max-md:pe-8',
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Title
>): React.ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn(
        'text-base font-semibold leading-snug tracking-tight',
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
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
