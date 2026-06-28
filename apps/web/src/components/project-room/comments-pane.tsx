'use client';
/**
 * Comments pane — frame-accurate thread for the active version.
 *
 *   - Sorted ascending by `timeMs` (matches the timeline).
 *   - "Add comment" is timeline-aware: opens a small composer at the
 *     current player position (we capture it from a window event
 *     emitted by the SecurePlayer telemetry — keeping the pane
 *     decoupled from the player ref).
 *   - Resolve / reopen / reply inline.
 *   - Realtime updates via Socket.io invalidate the query.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Textarea, Avatar } from '@vsp/ui';
import { Check, CornerDownRight, MessageSquare, Undo2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { CommentDto } from '@vsp/contracts';
import { useRealtime } from '@/lib/realtime';

export function CommentsPane({ versionId }: { versionId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  // Player emits a custom event with the current time on every progress tick.
  useEffect(() => {
    function on(e: Event) {
      const ms = (e as CustomEvent<{ ms: number }>).detail.ms;
      setCurrentTimeMs(ms);
    }
    window.addEventListener('vsp:player-time', on as EventListener);
    return () => window.removeEventListener('vsp:player-time', on as EventListener);
  }, []);

  useRealtime(versionId, () => {
    void qc.invalidateQueries({ queryKey: ['comments', versionId] });
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', versionId],
    queryFn: () => api.get<CommentDto[]>(`/versions/${versionId}/comments`),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    await api.post<CommentDto>('/comments', {
      assetVersionId: versionId,
      body,
      timeMs: currentTimeMs,
    });
    void qc.invalidateQueries({ queryKey: ['comments', versionId] });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 p-4">
        {comments.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
            <MessageSquare className="mx-auto mb-2 h-5 w-5" />
            No comments yet. Pause anywhere and leave a note.
          </div>
        )}
        {comments.map((c) => (
          <CommentCard key={c.id} comment={c} versionId={versionId} />
        ))}
      </div>

      <form onSubmit={submit} className="border-t border-border bg-card/40 p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>at {fmt(currentTimeMs)}</span>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment at the current frame…"
          className="min-h-16"
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" disabled={!text.trim()}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}

function CommentCard({ comment, versionId }: { comment: CommentDto; versionId: string }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const [showReply, setShowReply] = useState(false);

  async function toggleResolve() {
    const action = comment.status === 'OPEN' ? 'resolve' : 'reopen';
    await api.post(`/comments/${comment.id}/${action}`);
    void qc.invalidateQueries({ queryKey: ['comments', versionId] });
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    await api.post('/comments', {
      assetVersionId: versionId,
      parentId: comment.id,
      body: reply.trim(),
      timeMs: comment.timeMs,
    });
    setReply('');
    setShowReply(false);
    void qc.invalidateQueries({ queryKey: ['comments', versionId] });
  }

  function seekTo() {
    window.dispatchEvent(new CustomEvent('vsp:seek', { detail: { ms: comment.timeMs } }));
  }

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-start gap-2">
        <Avatar name={comment.authorDisplayName ?? '?'} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{comment.authorDisplayName ?? 'Reviewer'}</span>
            <button onClick={seekTo} className="font-mono text-xs text-primary hover:underline">
              {fmt(comment.timeMs)}
            </button>
            {comment.status === 'RESOLVED' && (
              <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">resolved</span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{comment.body}</p>
          <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
            <button onClick={() => setShowReply((s) => !s)} className="hover:text-foreground">
              <CornerDownRight className="mr-1 inline h-3 w-3" />
              Reply
            </button>
            <button onClick={toggleResolve} className="hover:text-foreground">
              {comment.status === 'OPEN' ? (
                <>
                  <Check className="mr-1 inline h-3 w-3" />
                  Resolve
                </>
              ) : (
                <>
                  <Undo2 className="mr-1 inline h-3 w-3" />
                  Reopen
                </>
              )}
            </button>
          </div>

          {showReply && (
            <form onSubmit={submitReply} className="mt-2 space-y-2">
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" className="min-h-14 text-sm" />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowReply(false)}>Cancel</Button>
                <Button type="submit" size="sm" disabled={!reply.trim()}>Reply</Button>
              </div>
            </form>
          )}

          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-3 space-y-2 border-l border-border pl-3">
              {comment.replies.map((r) => (
                <div key={r.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Avatar name={r.authorDisplayName ?? '?'} size={20} />
                    <span className="text-xs font-medium">{r.authorDisplayName ?? 'Reviewer'}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap leading-snug">{r.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
