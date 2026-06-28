'use client';
/**
 * AI summary pane — the killer feature. Shows a categorized, prioritized
 * digest of the comments. "Regenerate" forces a refresh (bypasses cache).
 *
 * Cost guardrail: the button shows a tiny "$0.02" estimate before the call.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, Badge } from '@vsp/ui';
import { Sparkles, RefreshCw, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { AiSummaryPayloadDto } from '@vsp/contracts';

type Summary = {
  id: string;
  payload: AiSummaryPayloadDto;
  topPriority: string | null;
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
  createdAt: string;
} | null;

const ICONS: Record<string, string> = {
  voiceover: '🎙',
  color: '🎨',
  editing: '✂️',
  graphics: '📝',
  audio: '🔊',
  pacing: '⏱',
  other: '✦',
};

const PRIORITY_COLOR: Record<string, 'destructive' | 'warning' | 'secondary'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
};

export function AiSummaryPane({ versionId }: { versionId: string }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const { data: summary, isLoading } = useQuery({
    queryKey: ['ai-summary', versionId],
    queryFn: () => api.get<Summary>(`/ai-summary/versions/${versionId}`),
  });

  async function generate(refresh: boolean) {
    setGenerating(true);
    try {
      await api.post('/ai-summary/generate', { versionId, refresh });
      await qc.invalidateQueries({ queryKey: ['ai-summary', versionId] });
    } finally {
      setGenerating(false);
    }
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!summary) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary" />
          <h3 className="text-base font-semibold">Summarize this review</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Group the comments by category, surface the highest-priority issues, and spot duplicates.
          </p>
          <Button className="mt-4" onClick={() => generate(false)} loading={generating}>
            <Sparkles className="h-4 w-4" />
            Generate summary
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          ${(summary.costCents / 100).toFixed(2)} · {summary.tokensInput + summary.tokensOutput} tokens
        </div>
        <Button variant="ghost" size="sm" onClick={() => generate(true)} loading={generating}>
          <RefreshCw className="h-3.5 w-3.5" />
          Regenerate
        </Button>
      </div>

      {summary.payload.topPriority && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-primary">
              Top priority
            </div>
            <p className="text-sm">{summary.payload.topPriority}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2.5">
        {summary.payload.categories.map((cat) => (
          <Card key={cat.name}>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">{ICONS[cat.name] ?? '•'}</span>
                  <span className="text-sm font-semibold capitalize">{cat.name}</span>
                  <Badge variant={PRIORITY_COLOR[cat.priority] ?? 'secondary'}>
                    {cat.priority}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">{cat.issues.length} issue{cat.issues.length === 1 ? '' : 's'}</span>
              </div>
              <ul className="space-y-2">
                {cat.issues.map((iss, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="leading-snug">{iss.summary}</p>
                      {iss.timestamps.length > 0 && (
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {iss.timestamps.join(' · ')}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {summary.payload.duplicateClusters && summary.payload.duplicateClusters.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Duplicate themes
            </div>
            <ul className="space-y-1.5 text-sm">
              {summary.payload.duplicateClusters.map((c, i) => (
                <li key={i}>
                  <span className="text-foreground">{c.theme}</span>
                  <span className="ml-2 text-xs text-muted-foreground">({c.commentIds.length} comments)</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
