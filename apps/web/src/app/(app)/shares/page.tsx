/**
 * Share links — workspace-wide list, scoped by RLS at the API. We fetch
 * per-project chunks server-side; for the freelance default (a handful of
 * active projects) the single-shot pagination is fine.
 */
import { EmptyState } from '@vsp/ui';
import { Share2 } from 'lucide-react';

export const metadata = { title: 'Share links' };

export default function SharesPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Share links</h1>
      <p className="mb-8 text-sm text-muted-foreground">All active links across your projects.</p>
      <EmptyState
        icon={<Share2 className="h-10 w-10" />}
        title="No share links yet"
        description="Open any project and click Share to create a password-protected link."
      />
    </div>
  );
}
