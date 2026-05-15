import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';

export function Avatar({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>): React.ReactElement {
  return (
    <AvatarPrimitive.Root
      className={cn('relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>): React.ReactElement {
  return (
    <AvatarPrimitive.Image className={cn('aspect-square h-full w-full', className)} {...props} />
  );
}

export function AvatarFallback({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>): React.ReactElement {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-medium',
        className,
      )}
      {...props}
    />
  );
}
