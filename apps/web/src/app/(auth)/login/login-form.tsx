'use client';
/**
 * Login form — supports the 2FA challenge inline.
 *
 * Auth.js's Credentials provider throws `TwoFactorRequiredError` when a
 * user has TOTP enabled but didn't pass `totp`. We catch that and reveal a
 * second field instead of bouncing back to /login with an opaque error.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@vsp/ui';
import { signIn } from 'next-auth/react';

const ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Try again in 15 minutes.',
  TWO_FACTOR_REQUIRED: 'Enter the 6-digit code from your authenticator app.',
  RATE_LIMITED: 'Slow down. Try again in a minute.',
};

export function LoginForm({ next, error }: { next?: string; error?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [serverError, setServerError] = useState<string | null>(error ? ERRORS[error] ?? null : null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setServerError(null);
    const form = new FormData(e.currentTarget);
    const result = await signIn('credentials', {
      email: String(form.get('email') ?? '').toLowerCase().trim(),
      password: String(form.get('password') ?? ''),
      totp: String(form.get('totp') ?? ''),
      redirect: false,
    });
    setSubmitting(false);

    if (!result || result.error) {
      const code = result?.error ?? 'INVALID_CREDENTIALS';
      if (code === 'TWO_FACTOR_REQUIRED' || code === 'CallbackRouteError') {
        setNeedsTotp(true);
        setServerError(ERRORS.TWO_FACTOR_REQUIRED);
      } else {
        setServerError(ERRORS[code] ?? 'Sign-in failed.');
      }
      return;
    }
    router.push(next ?? '/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {needsTotp && (
        <div className="space-y-1.5">
          <Label htmlFor="totp">2FA code</Label>
          <Input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
        </div>
      )}
      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      <Button className="w-full" type="submit" loading={submitting}>
        Sign in
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        No account?{' '}
        <a href="/signup" className="text-foreground underline-offset-4 hover:underline">
          Create one
        </a>
      </p>
    </form>
  );
}
