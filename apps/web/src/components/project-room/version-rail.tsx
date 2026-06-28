'use client';
/**
 * Version rail — horizontal strip of versions per asset, with quick switch.
 * Below the player. Click any version chip to make it active.
 */
import { cn, StatusPill } from '@vsp/ui';
import type { AssetDto } from '@vsp/contracts';
import { Film } from 'lucide-react';

type Props = {
  projectId: string;
  assets: AssetDto[];
  activeAssetId: string | null;
  onSelectAsset: (id: string) => void;
};

export function VersionRail({ assets, activeAssetId, onSelectAsset }: Props) {
  if (assets.length === 0) return null;
  return (
    <div className="border-t border-border bg-card/30 px-6 py-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {assets.map((a) => {
          const active = a.id === activeAssetId;
          const v = a.latestVersion;
          return (
            <button
              key={a.id}
              onClick={() => onSelectAsset(a.id)}
              className={cn(
                'group flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border bg-background/40 hover:border-border/80',
              )}
            >
              <Film className="h-4 w-4 text-muted-foreground" />
              <div className="text-left">
                <div className="text-sm font-medium leading-tight">{a.name}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  v{v?.versionNumber ?? '–'}
                  {v && <StatusPill status={v.reviewStatus} className="ml-1" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
