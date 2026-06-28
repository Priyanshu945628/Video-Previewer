import Link from 'next/link';
import { Button } from '@vsp/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">404</div>
        <h1 className="text-3xl font-semibold tracking-tight">Not here.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you were after doesn't exist, or you don't have access to it.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Back to projects</Link>
        </Button>
      </div>
    </div>
  );
}
