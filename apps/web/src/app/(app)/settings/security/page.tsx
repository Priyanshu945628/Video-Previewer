import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vsp/ui';
import { TwoFactorEnroll } from './two-factor-enroll';

export const metadata = { title: 'Security & 2FA' };

export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Add a TOTP code from an authenticator app on top of your password.
            Required when approving versions on projects with 2FA enforcement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorEnroll />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Sign out from all your devices at once.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              'use server';
              const { serverApi } = await import('@/lib/server-api');
              await serverApi.post('/auth/logout-all');
            }}
          >
            <button className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/20">
              Sign out everywhere
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
