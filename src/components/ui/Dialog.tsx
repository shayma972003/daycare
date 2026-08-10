"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function canDismissDialog(dismissBlocked: boolean): boolean {
  return !dismissBlocked;
}

export function closeDialogOnOpenChange(
  nextOpen: boolean,
  dismissBlocked: boolean,
  onClose: () => void
) {
  if (!nextOpen && canDismissDialog(dismissBlocked)) onClose();
}

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  dismissBlocked?: boolean;
};

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  {
    className,
    overlayClassName,
    dismissBlocked = false,
    onEscapeKeyDown,
    onPointerDownOutside,
    onInteractOutside,
    children,
    ...props
  },
  ref
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-dialog-overlay
        className={cn("fixed inset-0 z-50 bg-black/50", overlayClassName)}
      />
      <DialogPrimitive.Content
        ref={ref}
        data-dialog-content
        className={cn(
          "fixed inset-x-3 top-1/2 z-50 mx-auto max-h-[calc(100dvh-1.5rem)] w-auto max-w-lg -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-modal outline-none animate-scale-in sm:inset-x-4",
          className
        )}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          if (dismissBlocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          if (dismissBlocked) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (dismissBlocked) event.preventDefault();
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 items-start justify-between gap-4", className)} {...props} />;
}

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-bold text-[#111111]", className)}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-gray-500", className)}
      {...props}
    />
  );
});

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex shrink-0 flex-wrap items-center gap-3 border-t border-gray-100", className)}
      {...props}
    />
  );
}
