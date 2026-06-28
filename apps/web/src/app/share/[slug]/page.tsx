/**
 * Share-link viewer — no auth required. The gate decides whether to show
 * a password/email form or directly hand off to the player. Once gated,
 * the viewer cookie sits on /api/shares and the page becomes the same
 * player UX a logged-in client sees, minus the editor controls.
 */
import { ShareGate } from '@/components/share/share-gate';

export const metadata = { title: 'Review' };
export const dynamic = 'force-dynamic';

export default async function ShareLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="relative min-h-dvh bg-background">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      </div>
      <ShareGate slug={slug} />
    </div>
  );
}
