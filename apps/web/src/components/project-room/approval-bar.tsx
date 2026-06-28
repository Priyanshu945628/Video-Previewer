'use client';
/**
 * Approval bar — bottom strip showing version state + the three primary
 * client actions: Approve / Request changes / Reject.
 *
 * Also exposes the editor's Allow Download toggle. Optimistic UI: we
 * update local state immediately, roll back on error.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Switch, StatusPill } from '@vsp/ui';
import { Check, MessageCircleWarning, X, Download, FileText } from 'lucide-react';
import { api } from '@/lib/api-client';

export function ApprovalBar({
  versionId,
  reviewStatus,
  allowDownload,
}: {
  versionId: string;
  reviewStatus: 'PENDING' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'FINAL';
  allowDownload: boolean;
}) {
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [download, setDownload] = useState(allowDownload);

  async function setStatus(status: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED') {
    setSubmitting(status);
    try {
      await api.post('/approvals', { versionId, status });
      await qc.invalidateQueries();
    } finally {
      setSubmitting(null);
    }
  }

  async function toggleDownload(next: boolean) {
    setDownload(next);
    try {
      await api.patch(`/assets/versions/${versionId}/download`, { allow: next });
    } catch {
      setDownload(!next);
    }
  }

  async function exportReview() {
    await api.post('/review-exports/request', {
      versionId,
      format: 'PDF',
      includeResolved: true,
      includeDrawings: true,
      includeAiSummary: true,
    });
    // Surfaced in the user's notifications when complete.
  }

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border bg-card/40 px-6 py-3">
      <div className="flex items-center gap-3">
        <StatusPill status={reviewStatus} />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Allow client download</span>
          <Switch checked={download} onCheckedChange={toggleDownload} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={exportReview}>
          <FileText className="h-4 w-4" />
          Export review
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStatus('CHANGES_REQUESTED')}
          loading={submitting === 'CHANGES_REQUESTED'}
        >
          <MessageCircleWarning className="h-4 w-4" />
          Request changes
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStatus('REJECTED')}
          loading={submitting === 'REJECTED'}
        >
          <X className="h-4 w-4" />
          Reject
        </Button>
        <Button size="sm" onClick={() => setStatus('APPROVED')} loading={submitting === 'APPROVED'}>
          <Check className="h-4 w-4" />
          Approve
        </Button>
      </div>
    </div>
  );
}
