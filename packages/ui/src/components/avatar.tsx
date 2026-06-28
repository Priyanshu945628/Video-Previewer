import { cn } from '../lib/cn';

export function Avatar({
  name,
  src,
  className,
  size = 32,
}: {
  name?: string | null;
  src?: string | null;
  className?: string;
  size?: number;
}) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-secondary text-secondary-foreground text-xs font-medium',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name ?? ''} className="h-full w-full object-cover" />
      ) : (
        <span>{initials || '?'}</span>
      )}
    </div>
  );
}
