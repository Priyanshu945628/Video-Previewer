import { Card, CardContent, CardHeader, CardTitle } from '@vsp/ui';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

type Usage = { day: string; storageBytes: number; egressBytes: number; aiCostCents: number; activeViewers: number };
type Member = { user: { id: string; name: string | null; email: string; lastLoginAt: string | null; twoFactorEnabled: boolean }; role: string };

export default async function AdminPage() {
  let usage: Usage[] = [];
  let members: Member[] = [];
  try {
    usage = await serverApi.get<Usage[]>('/admin/usage?days=30');
  } catch {}
  try {
    members = await serverApi.get<Member[]>('/admin/members');
  } catch {}

  const totalStorage = usage.reduce((s, u) => s + Number(u.storageBytes), 0);
  const totalEgress = usage.reduce((s, u) => s + Number(u.egressBytes), 0);
  const totalAi = usage.reduce((s, u) => s + u.aiCostCents, 0);
  const peakViewers = usage.reduce((m, u) => Math.max(m, u.activeViewers), 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="mb-8 text-sm text-muted-foreground">Workspace-wide analytics and member management.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Storage (30d)" value={(totalStorage / 1024 ** 3).toFixed(1) + ' GB'} />
        <Stat title="Egress (30d)" value={(totalEgress / 1024 ** 3).toFixed(1) + ' GB'} />
        <Stat title="AI spend (30d)" value={'$' + (totalAi / 100).toFixed(2)} />
        <Stat title="Peak concurrent viewers" value={String(peakViewers)} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">2FA</th>
                <th className="px-4 py-2">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.user.id}>
                  <td className="px-4 py-2">{m.user.name ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.user.email}</td>
                  <td className="px-4 py-2">{m.role}</td>
                  <td className="px-4 py-2">{m.user.twoFactorEnabled ? 'On' : 'Off'}</td>
                  <td className="px-4 py-2">{m.user.lastLoginAt ? new Date(m.user.lastLoginAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
