'use client';
/**
 * Project room — orchestrates the player, comments, AI summary, version
 * switcher, and upload action for one project at a time.
 *
 * State machine:
 *   activeAssetId  → which asset is selected in the rail (default: latest)
 *   activeVersion  → which version of that asset is "primary" (default: last)
 *   compareVersion → optional second version for A/B (null off)
 *   panelTab       → 'comments' | 'ai' | 'activity'
 *
 * Streaming init happens lazily — only when an asset is selected AND the
 * version is READY. The player then receives a single signed manifest URL.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  StatusPill,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vsp/ui';
import { SecurePlayer } from '@vsp/player';
import { Plus, ArrowLeftRight, Share2, Download, History, Sparkles } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { AssetDto, ProjectDto, StreamInitResultDto } from '@vsp/contracts';
import { CommentsPane } from './comments-pane';
import { AiSummaryPane } from './ai-summary-pane';
import { VersionRail } from './version-rail';
import { UploadDialog } from './upload-dialog';
import { ShareLinkDialog } from './share-link-dialog';
import { ApprovalBar } from './approval-bar';

type Props = { project: ProjectDto & { assets: AssetDto[] } };

export function ProjectRoom({ project }: Props) {
  const qc = useQueryClient();
  const [activeAssetId, setActiveAssetId] = useState<string | null>(
    project.assets[0]?.id ?? null,
  );
  const [panelTab, setPanelTab] = useState<'comments' | 'ai' | 'activity'>('comments');

  const activeAsset = useMemo(
    () => project.assets.find((a) => a.id === activeAssetId) ?? null,
    [project.assets, activeAssetId],
  );
  const activeVersion = activeAsset?.latestVersion ?? null;

  // Stream init — only fire when version is READY.
  const streamQuery = useQuery({
    queryKey: ['stream', activeVersion?.id],
    enabled: !!activeVersion && activeVersion.status === 'READY',
    queryFn: () => api.post<StreamInitResultDto>('/stream/init', { versionId: activeVersion!.id }),
    staleTime: 30_000, // signed URLs are short-lived but the contract handles refresh
  });

  // When a new version uploads and processes, the rail's poller invalidates
  // and the player resets automatically.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['stream', activeVersion?.id] });
  }, [activeVersion?.id, activeVersion?.status, qc]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{project.name}</h1>
            {activeVersion && <StatusPill status={activeVersion.reviewStatus} />}
            {project.status === 'ARCHIVED' && <Badge variant="outline">Archived</Badge>}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {project.clientLabel ?? 'No client assigned'}
            {project.deadline && (
              <> · Due {new Date(project.deadline).toLocaleDateString()}</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ShareLinkDialog projectId={project.id} assetVersionId={activeVersion?.id ?? null}>
            <Button variant="outline" size="sm">
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </ShareLinkDialog>
          <UploadDialog projectId={project.id} onComplete={() => qc.invalidateQueries({ queryKey: ['project', project.id] })}>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Upload
            </Button>
          </UploadDialog>
        </div>
      </div>

      {/* ── Main split ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Player + version rail */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 bg-black p-6">
            {activeVersion?.status === 'READY' && streamQuery.data ? (
              <SecurePlayer
                manifestUrl={`${process.env.NEXT_PUBLIC_API_URL}${streamQuery.data.manifestUrl}`}
                watermarkText={streamQuery.data.watermarkText}
                posterUrl={streamQuery.data.posterUrl}
                handlers={{
                  onTelemetry: (e) => {
                    // Best-effort: don't await, don't error.
                    void api.post('/stream/events', { sessionId: 'pending', events: [e] }).catch(() => undefined);
                  },
                  onDevtoolsOpen: () => {
                    void api.post('/stream/events', { sessionId: 'pending', flag: 'devtoolsDetected' }).catch(() => undefined);
                  },
                  onScreenCapture: () => {
                    void api.post('/stream/events', { sessionId: 'pending', flag: 'recordingApiDetected' }).catch(() => undefined);
                  },
                }}
              />
            ) : activeVersion?.status === 'PROCESSING' ? (
              <ProcessingPlaceholder />
            ) : activeVersion?.status === 'FAILED' ? (
              <FailedPlaceholder />
            ) : (
              <EmptyPlaceholder />
            )}
          </div>

          <VersionRail
            projectId={project.id}
            assets={project.assets}
            activeAssetId={activeAssetId}
            onSelectAsset={setActiveAssetId}
          />

          {activeVersion && (
            <ApprovalBar
              versionId={activeVersion.id}
              reviewStatus={activeVersion.reviewStatus}
              allowDownload={activeVersion.allowDownload}
            />
          )}
        </div>

        {/* Right pane: comments / ai / activity */}
        <aside className="flex w-[420px] shrink-0 flex-col border-l border-border bg-card/30">
          <Tabs value={panelTab} onValueChange={(v) => setPanelTab(v as 'comments' | 'ai' | 'activity')} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border px-3 py-2">
              <TabsList>
                <TabsTrigger value="comments">Comments</TabsTrigger>
                <TabsTrigger value="ai">
                  <Sparkles className="h-3 w-3" />
                  AI Summary
                </TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="comments" className="m-0 min-h-0 flex-1 overflow-y-auto">
              {activeVersion ? (
                <CommentsPane versionId={activeVersion.id} />
              ) : (
                <div className="p-6 text-sm text-muted-foreground">Upload an asset to start reviewing.</div>
              )}
            </TabsContent>
            <TabsContent value="ai" className="m-0 min-h-0 flex-1 overflow-y-auto">
              {activeVersion ? (
                <AiSummaryPane versionId={activeVersion.id} />
              ) : (
                <div className="p-6 text-sm text-muted-foreground">No asset selected.</div>
              )}
            </TabsContent>
            <TabsContent value="activity" className="m-0 min-h-0 flex-1 overflow-y-auto">
              <div className="p-6 text-sm text-muted-foreground">Activity feed coming online…</div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

function ProcessingPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-card/30">
      <div className="text-center">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm font-medium">Encoding your video</p>
        <p className="mt-1 text-xs text-muted-foreground">HLS + AES-128 in progress. You can leave; we'll keep going.</p>
      </div>
    </div>
  );
}

function FailedPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-destructive/30 bg-destructive/10 text-destructive">
      <div className="text-center">
        <p className="text-sm font-medium">Encoding failed</p>
        <p className="mt-1 text-xs">Upload again or get in touch if it keeps failing.</p>
      </div>
    </div>
  );
}

function EmptyPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-card/20">
      <div className="text-center">
        <p className="text-sm font-medium">No version uploaded yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Drop your first cut and we'll do the rest.</p>
      </div>
    </div>
  );
}
