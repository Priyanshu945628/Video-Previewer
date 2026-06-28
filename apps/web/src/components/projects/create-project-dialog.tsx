'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Switch,
  Textarea,
} from '@vsp/ui';
import { api } from '@/lib/api-client';

export function CreateProjectDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      const project = await api.post<{ id: string }>('/projects', {
        name: String(f.get('name')).trim(),
        clientLabel: String(f.get('clientLabel')).trim() || undefined,
        description: String(f.get('description')).trim() || undefined,
        deadline: f.get('deadline') ? new Date(String(f.get('deadline'))).toISOString() : undefined,
        watermarkTemplate: '{name} · {email} · {date} {time} · CONFIDENTIAL',
        allowDownloadDefault: false,
        requireTwoFactorOnApprove: f.get('require2fa') === 'on',
        aiSummaryEnabled: f.get('ai') === 'on',
      });
      setOpen(false);
      router.push(`/p/${project.id}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>You can change any of these later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Project name</Label>
            <Input id="name" name="name" required autoFocus placeholder="Acme Q3 Launch" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clientLabel">Client</Label>
              <Input id="clientLabel" name="clientLabel" placeholder="Acme Co." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deadline">Deadline</Label>
              <Input id="deadline" name="deadline" type="date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" placeholder="What's the brief?" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">AI review summaries</p>
              <p className="text-xs text-muted-foreground">Categorize and prioritize client feedback automatically.</p>
            </div>
            <Switch id="ai" name="ai" defaultChecked />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Require 2FA on approval</p>
              <p className="text-xs text-muted-foreground">Extra step before status changes to APPROVED.</p>
            </div>
            <Switch id="require2fa" name="require2fa" />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Create project</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
