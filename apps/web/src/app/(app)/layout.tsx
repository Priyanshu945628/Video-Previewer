/**
 * Authenticated app shell.
 *
 * Renders the persistent sidebar + topbar around all project / dashboard
 * routes. The session is read server-side via `auth()` so the shell can
 * hydrate user state without a client round-trip.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { WorkspaceProvider } from '@/components/shell/workspace-provider';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <WorkspaceProvider session={session}>
      <div className="grid min-h-dvh grid-cols-[16rem_1fr] bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-col">
          <Topbar />
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
