import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 8,
  collisionPadding = 12,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>): React.ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 max-h-[calc(100dvh-1.5rem)] w-72 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-none',
          'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          'motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
