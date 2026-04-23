import { forwardRef } from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const labelVariants = cva(
  'text-xs font-medium uppercase tracking-wide text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

const Label = forwardRef(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(labelVariants(), className)}
      {...props}
    />
  );
});

export { Label };
