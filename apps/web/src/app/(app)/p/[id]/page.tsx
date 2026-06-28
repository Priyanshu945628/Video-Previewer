/**
 * Project room — the place editors and clients spend their day.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Project header (name, client, status, actions)              │
 *   ├─────────────────────────────────┬───────────────────────────┤
 *   │                                  │                            │
 *   │  Player + watermark              │   Comments / AI summary    │
 *   │  Custom controls + scrubber      │   tabs                     │
 *   │  Version switcher / compare      │                            │
 *   │                                  │                            │
 *   ├─────────────────────────────────┴───────────────────────────┤
 *   │  Asset rail (versions + other assets)                        │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The server component fetches the project + assets up-front so the URL
 * survives refresh. The player and review pane live inside a client
 * component for the streaming + realtime hooks.
 */
import { notFound } from 'next/navigation';
import { ProjectRoom } from '@/components/project-room/project-room';
import { serverApi } from '@/lib/server-api';
import type { ProjectDto, AssetDto } from '@vsp/contracts';

export const dynamic = 'force-dynamic';

type ProjectWithAssets = ProjectDto & { assets: AssetDto[] };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let project: ProjectWithAssets | null = null;
  try {
    project = await serverApi.get<ProjectWithAssets>(`/projects/${id}`);
  } catch {
    notFound();
  }
  if (!project) notFound();

  return <ProjectRoom project={project} />;
}
