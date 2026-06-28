import { Card, CardContent, CardDescription, CardHeader, CardTitle, Switch } from '@vsp/ui';

export const metadata = { title: 'Notifications' };

const PREFS = [
  { key: 'emailComments', label: 'Comments', help: 'Someone comments on a version you own.' },
  { key: 'emailVersions', label: 'New versions', help: 'A new version is uploaded to a project you follow.' },
  { key: 'emailApprovals', label: 'Approvals', help: 'A client approves or requests changes.' },
  { key: 'emailDownloads', label: 'Downloads', help: 'A client downloads a file you delivered.' },
];

export default function NotificationsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email notifications</CardTitle>
        <CardDescription>Pick what's worth pinging you about. Defaults are sane.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {PREFS.map((p) => (
          <div key={p.key} className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium">{p.label}</div>
              <div className="text-xs text-muted-foreground">{p.help}</div>
            </div>
            <Switch name={p.key} defaultChecked />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
