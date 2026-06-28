import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@vsp/ui';
import { Archive } from 'lucide-react';
import { serverApi } from '@/lib/server-api';
import type { ProjectDto } from '@vsp/contracts';

export const metadata = { title: 'Archive' };
export const dynamic = 'force-dynamic';

export default async function ArchivePage() {
  let archived: ProjectDto[] = [];
  try {
    archived = await serverApi.get('/projects?archived=true&limit=100');
  } catch {
    archived = [];
  }
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Archive</h1>
      <p className="mb-8 text-sm text-muted-foreground">Projects you've put on the shelf. Open one to restore it.</p>

      {archived.length === 0 ? (
        <EmptyState icon={<Archive className="h-10 w-10" />} title="Nothing archived" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {archived.map((p) => (
            <Link key={p.id} href={`/p/${p.id}`}>
              <Card className="opacity-70 transition-opacity hover:opacity-100">
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Archived {p.archivedAt ? new Date(p.archivedAt).toLocaleDateString() : '—'}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
