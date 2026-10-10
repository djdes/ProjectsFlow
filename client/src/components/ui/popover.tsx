import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@/lib/utils';
import {
  MobileSheetHandle,
  MobileSurfaceContext,
  useMobileSheet,
  useMobileSheetSurface,
} from './mobile-sheet';

export function Popover({
  modal,
  mobileSheet = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> & {
  mobileSheet?: boolean;
}): React.ReactElement {
  const mobile = useMobileSheet(mobileSheet);
  return (
    <MobileSurfaceContext.Provider value={mobile}>
      <PopoverPrimitive.Root {...props} modal={mobile || modal} />
    </MobileSurfaceContext.Provider>
  );
}
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 8,
  collisionPadding = 12,
  children,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
>): React.ReactElement {
  const mobile = React.useContext(MobileSurfaceContext);
  const { ref: surfaceRef, closeRef } = useMobileSheetSurface(mobile);
  return (
    <>
      {mobile && (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Close asChild>
            <div aria-hidden="true" data-pf-mobile-backdrop="true" />
          </PopoverPrimitive.Close>
        </PopoverPrimitive.Portal>
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={surfaceRef}
          data-pf-mobile-sheet={mobile || undefined}
          data-pf-motion-surface="popover"
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cn(
            'z-50 max-h-[calc(100dvh-1.5rem)] w-72 overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-menu outline-none',
            'animate-in fade-in-0 motion-safe:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-95',
            'motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2',
            'motion-reduce:animate-none',
            className,
          )}
          {...props}
        >
          {mobile && (
            <PopoverPrimitive.Close asChild>
              <MobileSheetHandle ref={closeRef} />
            </PopoverPrimitive.Close>
          )}
          {mobile ? (
            <div className="pf-mobile-sheet-scroll">{children}</div>
          ) : (
            children
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </>
  );
}
