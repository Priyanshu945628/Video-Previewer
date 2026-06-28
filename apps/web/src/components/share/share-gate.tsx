'use client';
/**
 * Share gate — three states:
 *   1. Locked: render password / email form, POST /api/share/:slug/gate
 *   2. Unlocked: render the player + simplified review pane
 *   3. Denied: a friendly error (expired / revoked / view-limit hit)
 *
 * On unlock, the viewer cookie is set by the API; we then call
 * /api/share/init to obtain the manifest URL and watermark token.
 */
import { useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@vsp/ui';
import { SecurePlayer } from '@vsp/player';
import { api } from '@/lib/api-client';
import type { StreamInitResultDto } from '@vsp/contracts';

type GateError = 'PASSWORD_REQUIRED' | 'PASSWORD_INVALID' | 'EMAIL_REQUIRED' | 'EXPIRED' | 'REVOKED' | 'VIEW_LIMIT';

export function ShareGate({ slug }: { slug: string }) {
  const [stream, setStream] = useState<StreamInitResultDto | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [err, setErr] = useState<GateError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);

  async function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      await api.post(`/shares/${slug}/gate`, {
        slug,
        password: f.get('password') ? String(f.get('password')) : undefined,
        email: f.get('email') ? String(f.get('email')) : undefined,
        name: f.get('name') ? String(f.get('name')) : undefined,
      });
      // Init stream — the API decides which version to stream based on the link.
      const meta = await api.post<{ versionId: string }>('/shares/version');
      setVersionId(meta.versionId);
      const init = await api.post<StreamInitResultDto>('/stream/share-init', { versionId: meta.versionId });
      setStream(init);
    } catch (e) {
      const code = (e as { code?: string }).code as GateError | undefined;
      if (code === 'PASSWORD_REQUIRED') setNeedsPassword(true);
      else if (code === 'EMAIL_REQUIRED') setNeedsEmail(true);
      else setErr(code ?? 'EXPIRED');
    } finally {
      setSubmitting(false);
    }
  }

  if (stream && versionId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">VSP · Review</div>
          <h1 className="text-xl font-semibold">Your client review</h1>
        </div>
        <SecurePlayer
          manifestUrl={`${process.env.NEXT_PUBLIC_API_URL}${stream.manifestUrl}`}
          watermarkText={stream.watermarkText}
          posterUrl={stream.posterUrl}
        />
      </div>
    );
  }

  if (err && !needsPassword && !needsEmail) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4">
        <Card>
          <CardHeader>
            <CardTitle>This link can't be opened</CardTitle>
            <CardDescription>
              {err === 'EXPIRED' && 'The link has expired. Ask the editor to send a new one.'}
              {err === 'REVOKED' && 'The link was revoked.'}
              {err === 'VIEW_LIMIT' && 'The link has reached its view limit.'}
              {(err === 'PASSWORD_INVALID' as GateError) && 'Wrong password.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">VSP</div>
          <CardTitle>Open this review</CardTitle>
          <CardDescription>You're a few seconds away from the cut.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={unlock} className="space-y-4">
            {needsEmail && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
              </>
            )}
            {needsPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required autoFocus />
              </div>
            )}
            {!needsPassword && !needsEmail && (
              <p className="text-sm text-muted-foreground">Click below to open. We'll ask for anything we need.</p>
            )}
            {err === 'PASSWORD_INVALID' && <p className="text-sm text-destructive">Wrong password.</p>}
            <Button className="w-full" type="submit" loading={submitting}>
              Open review
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
