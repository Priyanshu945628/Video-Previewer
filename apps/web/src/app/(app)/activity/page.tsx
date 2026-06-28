/**
 * Activity log. Workspace-scoped audit feed surfaced from the API's
 * `/activity` endpoint (which reads the hash-chained audit_events table).
 */
import { Card, CardContent, EmptyState, Badge } from '@vsp/ui';
import { Activity } from 'lucide-react';
import { serverApi } from '@/lib/server-api';
import type { ActivityEventDto } from '@vsp/contracts';

export const metadata = { title: 'Activity' };
export const dynamic = 'force-dynamic';

const LABEL: Record<string, string> = {
  'project.created': 'created a project',
  'project.updated': 'updated a project',
  'project.archived': 'archived a project',
  'version.uploaded': 'uploaded a new version',
  'comment.added': 'commented',
  'comment.resolved': 'resolved a comment',
  'approval.approved': 'approved a version',
  'approval.changes_requested': 'requested changes',
  'approval.rejected': 'rejected a version',
  'share.created': 'created a share link',
  'share.viewed': 'opened a share link',
  'download.granted': 'downloaded a file',
  'stream.key_served': 'started playback',
  'ai.summary_generated': 'generated an AI summary',
};

export default async function ActivityPage() {
  let events: (ActivityEventDto & { actor?: { name: string | null; email: string } })[] = [];
  try {
    events = await serverApi.get('/activity?limit=100');
  } catch {
    events = [];
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="mb-8 text-sm text-muted-foreground">Everything that happened in this workspace — append-only and tamper-evident.</p>

      {events.length === 0 ? (
        <EmptyState icon={<Activity className="h-10 w-10" />} title="Nothing logged yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className="font-medium">{e.actorName ?? e.actor?.name ?? e.actor?.email ?? 'System'}</span>{' '}
                      <span className="text-muted-foreground">{LABEL[e.action] ?? e.action}</span>
                      {e.targetId && (
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground/70">{e.targetId.slice(0, 8)}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                      {e.ip && <span className="ml-2">· {e.ip}</span>}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">{e.action.split('.')[0]}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
