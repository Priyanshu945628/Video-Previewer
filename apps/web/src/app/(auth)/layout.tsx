/**
 * Auth-segment layout — minimal, centered, no nav.
 * Same dark glass treatment as the rest of the product.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in' };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4">
      {/* Premium gradient glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-fuchsia-500/10 blur-[100px]" />
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
