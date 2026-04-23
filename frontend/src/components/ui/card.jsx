import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const Card = forwardRef(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className
      )}
      {...props}
    />
  );
});

const CardHeader = forwardRef(function CardHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('flex items-start justify-between gap-3 p-5 pb-3', className)}
      {...props}
    />
  );
});

const CardTitleGroup = forwardRef(function CardTitleGroup({ className, ...props }, ref) {
  return <div ref={ref} className={cn('min-w-0', className)} {...props} />;
});

const CardTitle = forwardRef(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn('text-sm font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
});

const CardDescription = forwardRef(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn('mt-1.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
});

const CardContent = forwardRef(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn('px-5 pb-5', className)} {...props} />;
});

const CardFooter = forwardRef(function CardFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center border-t border-border px-5 py-3', className)}
      {...props}
    />
  );
});

export {
  Card,
  CardHeader,
  CardTitleGroup,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
