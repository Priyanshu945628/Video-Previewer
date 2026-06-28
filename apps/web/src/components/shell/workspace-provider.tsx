'use client';
import { createContext, useContext, useMemo } from 'react';
import type { Session } from 'next-auth';

type WorkspaceContext = {
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  };
};

const Ctx = createContext<WorkspaceContext | null>(null);

export function WorkspaceProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  const value = useMemo<WorkspaceContext>(
    () => ({
      user: {
        id: (session.user as { id?: string }).id ?? '',
        email: session.user?.email ?? '',
        name: session.user?.name ?? null,
        image: session.user?.image ?? null,
      },
    }),
    [session],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
