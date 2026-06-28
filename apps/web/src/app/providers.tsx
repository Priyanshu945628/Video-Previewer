'use client';
/**
 * Client-side providers — TanStack Query + Radix toast portal.
 * Auth state lives in Auth.js's own SessionProvider (mounted per-segment so
 * the share-link viewer can opt out of it).
 */
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, ToastViewport } from '@vsp/ui';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, err) => {
              const status = (err as { status?: number }).status;
              if (status && status >= 400 && status < 500 && status !== 408) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        {children}
        <ToastViewport />
      </ToastProvider>
    </QueryClientProvider>
  );
}
