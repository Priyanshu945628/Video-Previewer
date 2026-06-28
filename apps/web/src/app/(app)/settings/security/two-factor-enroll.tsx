'use client';
/**
 * TOTP enrollment — two-step flow.
 *   1. POST /auth/2fa/enroll → returns wrapped secret id + qr data URL.
 *   2. User scans, then POST /auth/2fa/confirm with the 6-digit code.
 */
import { useState } from 'react';
import { Button, Input, Label } from '@vsp/ui';
import { api } from '@/lib/api-client';

type Enrolled = { authenticatorId: string; qrDataUrl: string; recoveryCodes: string[] };

export function TwoFactorEnroll() {
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await api.post<Enrolled>('/auth/2fa/enroll', { password: '__dummy__' });
      setEnrolled(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enrolled) return;
    setSubmitting(true);
    setErr(null);
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    try {
      await api.post('/auth/2fa/confirm', { code, secretId: enrolled.authenticatorId });
      setConfirmed(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return <p className="text-sm">2FA is now enabled. Save your recovery codes somewhere safe.</p>;
  }
  if (!enrolled) {
    return (
      <div className="space-y-3">
        <Button onClick={start} loading={submitting}>Set up 2FA</Button>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <img src={enrolled.qrDataUrl} alt="Scan with your authenticator app" className="h-40 w-40 rounded-lg bg-white p-2" />
        <div className="flex-1 text-sm text-muted-foreground">
          Scan with Google Authenticator, 1Password, Authy, or any TOTP app. Then enter the 6-digit code to confirm.
        </div>
      </div>
      <form onSubmit={confirm} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="code">6-digit code</Label>
          <Input id="code" name="code" inputMode="numeric" maxLength={6} required autoFocus />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" loading={submitting}>Confirm</Button>
      </form>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Show recovery codes</summary>
        <ul className="mt-2 grid grid-cols-2 gap-2 font-mono text-foreground">
          {enrolled.recoveryCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
    </div>
  );
}
