'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@vsp/ui';
import { api } from '@/lib/api-client';
import { signIn } from 'next-auth/react';

export function SignupForm() {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      await api.post('/auth/signup', {
        email: String(f.get('email')).toLowerCase().trim(),
        password: String(f.get('password')),
        name: String(f.get('name')).trim(),
        workspaceName: String(f.get('workspaceName')).trim(),
      });
      await signIn('credentials', {
        email: String(f.get('email')).toLowerCase().trim(),
        password: String(f.get('password')),
        redirect: false,
      });
      router.push('/');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workspaceName">Workspace</Label>
          <Input id="workspaceName" name="workspaceName" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <p className="text-xs text-muted-foreground">12+ characters, upper, lower, digit.</p>
      </div>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <Button className="w-full" type="submit" loading={submitting}>
        Create workspace
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{' '}
        <a href="/login" className="text-foreground underline-offset-4 hover:underline">
          Sign in
        </a>
      </p>
    </form>
  );
}
