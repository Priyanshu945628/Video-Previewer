import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@vsp/ui';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Workspace' };
export const dynamic = 'force-dynamic';

type WorkspaceDto = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  storageUsedBytes: number;
  storageLimitBytes: number;
};

function fmtGB(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1) + ' GB';
}

export default async function WorkspacePage() {
  const ws = await serverApi.get<WorkspaceDto>('/workspaces/current');
  const pct = Math.min(100, Math.round((ws.storageUsedBytes / Math.max(1, ws.storageLimitBytes)) * 100));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>The shared space your clients see in share links.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" defaultValue={ws.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-slug">Slug</Label>
            <Input id="ws-slug" defaultValue={ws.slug} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>{ws.plan} plan · {fmtGB(ws.storageUsedBytes)} of {fmtGB(ws.storageLimitBytes)} used</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
