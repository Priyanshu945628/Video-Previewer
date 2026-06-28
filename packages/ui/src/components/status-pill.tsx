import { cn } from '../lib/cn';

type Status = 'PENDING' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'FINAL' | 'PROCESSING' | 'FAILED' | 'READY';

const STYLES: Record<Status, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  IN_REVIEW: 'bg-primary/15 text-primary',
  CHANGES_REQUESTED: 'bg-warning/15 text-warning',
  APPROVED: 'bg-success/15 text-success',
  FINAL: 'bg-success/20 text-success',
  PROCESSING: 'bg-primary/10 text-primary',
  READY: 'bg-success/15 text-success',
  FAILED: 'bg-destructive/15 text-destructive',
};

const LABELS: Record<Status, string> = {
  PENDING: 'Pending',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  FINAL: 'Final',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        STYLES[status],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
