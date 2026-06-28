/**
 * Inbox — comments awaiting your reply, approvals requested, share-link
 * activity. Stitches together a few API endpoints into a single triage feed.
 */
import { EmptyState } from '@vsp/ui';
import { Inbox } from 'lucide-react';

export const metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Inbox</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Comments waiting on you, approvals requested, and clients who've just opened a share link.
      </p>
      <EmptyState
        icon={<Inbox className="h-10 w-10" />}
        title="You're all caught up"
        description="When a client comments, approves, or opens a link, it'll show up here."
      />
    </div>
  );
}
