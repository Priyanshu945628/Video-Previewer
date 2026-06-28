/**
 * Projects index. Server-fetches the project list using the cookie-bound
 * API client, falls through to the empty state, and offers a "Create"
 * action that opens the dialog on the client.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@vsp/ui';
import { Plus, FolderOpen, MessageSquare, Clock } from 'lucide-react';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { serverApi } from '@/lib/server-api';
import type { ProjectDto } from '@vsp/contracts';

export const metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  await headers(); // mark dynamic
  let projects: (ProjectDto & { _count?: { assets: number } })[] = [];
  try {
    projects = await serverApi.get('/projects');
  } catch {
    projects = [];
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All your work in progress. Click any project to open the review room.
          </p>
        </div>
        <CreateProjectDialog>
          <Button>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </CreateProjectDialog>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-10 w-10" />}
          title="No projects yet"
          description="Start by creating a project. Upload your first cut and invite a client to review."
          action={
            <CreateProjectDialog>
              <Button>
                <Plus className="h-4 w-4" />
                Create your first project
              </Button>
            </CreateProjectDialog>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/p/${p.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{p.name}</CardTitle>
                      <CardDescription className="truncate">
                        {p.clientLabel ?? 'No client'}
                      </CardDescription>
                    </div>
                    {p.status === 'ARCHIVED' && <Badge variant="outline">Archived</Badge>}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <FolderOpen className="h-3.5 w-3.5" />
                      {p._count?.assets ?? 0} assets
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {p.counts?.openComments ?? 0} open
                    </span>
                    {p.deadline && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(p.deadline).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
