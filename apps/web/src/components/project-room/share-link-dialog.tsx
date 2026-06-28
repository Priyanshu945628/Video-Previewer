'use client';
/**
 * Share-link dialog — creates a password-optional, expiry-bounded link
 * for clients who don't have accounts. The share URL is copied to the
 * clipboard on success; password (if any) must be shared out-of-band.
 */
import { useState } from 'react';
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
} from '@vsp/ui';
import { Copy, Check } from 'lucide-react';
import { api } from '@/lib/api-client';

const EXPIRY_OPTIONS = [
  { value: '24h', label: '24 hours' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'never', label: 'Never' },
];

export function ShareLinkDialog({
  projectId,
  assetVersionId,
  children,
}: {
  projectId: string;
  assetVersionId: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    setUrl(null);
    const f = new FormData(e.currentTarget);
    try {
      const result = await api.post<{ url: string }>('/share-links', {
        projectId,
        assetVersionId,
        password: f.get('password') ? String(f.get('password')) : undefined,
        requireEmail: f.get('requireEmail') === 'on',
        allowComments: f.get('allowComments') === 'on',
        allowDownload: f.get('allowDownload') === 'on',
        expiry: String(f.get('expiry')),
      });
      setUrl(result.url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function reset() {
    setUrl(null);
    setErr(null);
    setCopied(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share link</DialogTitle>
          <DialogDescription>
            Send a password-protected link to a reviewer who doesn't have an account.
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card/40 p-3">
              <div className="text-xs font-medium text-muted-foreground">Share URL</div>
              <div className="mt-1 font-mono text-sm break-all">{url}</div>
            </div>
            <Button onClick={copy} variant="outline" className="w-full">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="ghost" onClick={reset} className="w-full">Create another</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password (optional)</Label>
              <Input id="password" name="password" type="password" placeholder="Leave blank for no password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiry">Expires</Label>
              <select
                id="expiry"
                name="expiry"
                defaultValue="7d"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2">
              <Label htmlFor="requireEmail" className="cursor-pointer">Require email</Label>
              <Switch id="requireEmail" name="requireEmail" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2">
              <Label htmlFor="allowComments" className="cursor-pointer">Allow comments</Label>
              <Switch id="allowComments" name="allowComments" defaultChecked />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2">
              <Label htmlFor="allowDownload" className="cursor-pointer">Allow download</Label>
              <Switch id="allowDownload" name="allowDownload" />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={submitting}>Generate link</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
