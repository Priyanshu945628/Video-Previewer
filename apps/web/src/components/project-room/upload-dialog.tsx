'use client';
/**
 * Upload dialog — direct-to-R2 multipart resumable upload.
 *
 *   1. POST /assets to create an Asset row (kind: VIDEO).
 *   2. POST /assets/upload/init → uploadId + key + versionId.
 *   3. PUT each 8 MiB part to a presigned URL acquired via /assets/upload/part.
 *   4. POST /assets/upload/complete to finalize → enqueues transcode.
 *
 * Errors at any step roll back the in-progress UI; partial multiparts are
 * GC'd by R2 lifecycle (and the sweep worker as a safety net).
 */
import { useRef, useState } from 'react';
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
} from '@vsp/ui';
import { api } from '@/lib/api-client';
import { Upload } from 'lucide-react';

const PART_SIZE = 8 * 1024 * 1024;

type InitResp = { uploadId: string; key: string; versionId: string; versionNumber: number };

export function UploadDialog({
  projectId,
  onComplete,
  children,
}: {
  projectId: string;
  onComplete?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState<'idle' | 'init' | 'upload' | 'finalize' | 'done' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setPct(0);
    const f = fileRef.current?.files?.[0];
    const name = String((new FormData(e.currentTarget)).get('name') ?? '').trim();
    if (!f || !name) return;

    try {
      setStage('init');
      const asset = await api.post<{ id: string }>('/assets', {
        projectId,
        kind: 'VIDEO',
        name,
      });

      const init = await api.post<InitResp>('/assets/upload/init', {
        assetId: asset.id,
        filename: f.name,
        sizeBytes: f.size,
        mimeType: f.type || 'video/mp4',
      });

      setStage('upload');
      const parts: { ETag: string; PartNumber: number }[] = [];
      const totalParts = Math.ceil(f.size / PART_SIZE);
      for (let i = 0; i < totalParts; i++) {
        const start = i * PART_SIZE;
        const end = Math.min(f.size, start + PART_SIZE);
        const blob = f.slice(start, end);

        const url = await api.post<string>('/assets/upload/part', {
          key: init.key,
          uploadId: init.uploadId,
          partNumber: i + 1,
        });

        const r = await fetch(url, { method: 'PUT', body: blob });
        if (!r.ok) throw new Error(`part ${i + 1} failed: HTTP ${r.status}`);
        const etag = (r.headers.get('ETag') ?? '').replace(/"/g, '');
        parts.push({ ETag: etag, PartNumber: i + 1 });
        setPct(Math.round(((i + 1) / totalParts) * 95));
      }

      setStage('finalize');
      await api.post('/assets/upload/complete', {
        versionId: init.versionId,
        uploadId: init.uploadId,
        parts,
      });

      setStage('done');
      setPct(100);
      setTimeout(() => {
        setOpen(false);
        setStage('idle');
        setPct(0);
        onComplete?.();
      }, 600);
    } catch (e) {
      setStage('error');
      setErr((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a cut</DialogTitle>
          <DialogDescription>
            We'll transcode to HLS, encrypt with AES-128, and notify your client when it's ready.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={start} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Asset name</Label>
            <Input id="name" name="name" required placeholder="Hero cut v3" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="file">Video file</Label>
            <Input id="file" ref={fileRef} type="file" accept="video/*" required disabled={stage !== 'idle' && stage !== 'error'} />
          </div>

          {stage !== 'idle' && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {stage === 'init' && 'Reserving slot…'}
                  {stage === 'upload' && 'Uploading…'}
                  {stage === 'finalize' && 'Finalizing…'}
                  {stage === 'done' && 'Done — transcoding in background.'}
                  {stage === 'error' && 'Failed.'}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={stage === 'upload' || stage === 'finalize'}>
              Cancel
            </Button>
            <Button type="submit" loading={stage === 'init' || stage === 'upload' || stage === 'finalize'}>
              <Upload className="h-4 w-4" />
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
