'use client';
import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn(
        'fixed bottom-4 right-4 z-[100] flex max-h-screen w-full flex-col gap-2 p-2 sm:max-w-sm',
        className,
      )}
      {...props}
    />
  );
});

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & { variant?: 'default' | 'destructive' }
>(function Toast({ className, variant = 'default', ...props }, ref) {
  return (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(
        'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg transition-all',
        'data-[state=open]:animate-fade-in',
        variant === 'default'
          ? 'border-border bg-card text-card-foreground'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
      {...props}
    />
  );
});

export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(function ToastTitle({ className, ...props }, ref) {
  return <ToastPrimitive.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />;
});

export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(function ToastDescription({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Description
      ref={ref}
      className={cn('text-sm opacity-90', className)}
      {...props}
    />
  );
});

export const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(function ToastClose({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Close
      ref={ref}
      className={cn(
        'absolute right-2 top-2 rounded-md p-1 text-foreground/60 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100',
        className,
      )}
      toast-close=""
      {...props}
    >
      <X className="h-3.5 w-3.5" />
    </ToastPrimitive.Close>
  );
});
